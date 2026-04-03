/*
 * antigravity-relay: TLS SNI-aware transparent TCP relay
 *
 * Flow:
 *   1. Accepts TCP connections on 127.0.0.1:RELAY_PORT (default 44300)
 *   2. Peeks at TLS ClientHello, extracts SNI (Server Name Indication)
 *   3. Connects to SOCKS5 proxy and requests the SNI hostname:443
 *   4. Transparently proxies the full TCP stream (SNI bytes included)
 *
 * This allows transparent proxying of HTTPS connections even for programs
 * that use raw syscalls (like Go's net package) and ignore HTTPS_PROXY.
 * The caller must redirect port 443 → RELAY_PORT via pfctl or similar.
 *
 * Usage: antigravity-relay [relay_port] [socks5_host] [socks5_port]
 *   Defaults: 44300  127.0.0.1  10808
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <fcntl.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <netdb.h>
#include <time.h>
#include <stdarg.h>

/* ── Config ───────────────────────────────────────────────────────── */
static int         g_relay_port   = 44300;
static char        g_socks5_host[64] = "127.0.0.1";
static int         g_socks5_port  = 10808;
static int         g_verbose      = 1;

#define PEEK_BUF  2048    /* bytes to read for SNI sniffing */
#define BUF_SIZE  65536   /* pipe buffer */

/* ── Logging ──────────────────────────────────────────────────────── */
static pthread_mutex_t g_log_mu = PTHREAD_MUTEX_INITIALIZER;
static void rlog(const char *fmt, ...) {
    if (!g_verbose) return;
    struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts);
    struct tm tm; localtime_r(&ts.tv_sec, &tm);
    char tbuf[32];
    snprintf(tbuf, sizeof(tbuf), "%02d:%02d:%02d.%03d",
             tm.tm_hour, tm.tm_min, tm.tm_sec, (int)(ts.tv_nsec/1000000));
    va_list ap; va_start(ap, fmt);
    pthread_mutex_lock(&g_log_mu);
    fprintf(stderr, "\033[36m%s\033[0m [relay] ", tbuf);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    pthread_mutex_unlock(&g_log_mu);
    va_end(ap);
}

/* ── TLS ClientHello SNI parser ───────────────────────────────────── */
/*
 * Returns a pointer to a static buffer containing the SNI hostname,
 * or NULL if not found / not a TLS ClientHello.
 */
static int parse_sni(const uint8_t *buf, ssize_t len, char *out, size_t out_size) {
    /* Must be at least a TLS record header + handshake header */
    if (len < 9) return -1;
    /* Content type: 0x16 = handshake */
    if (buf[0] != 0x16) return -1;
    /* Handshake type: 0x01 = ClientHello */
    if (buf[5] != 0x01) return -1;

    /* p points to start of ClientHello body (after handshake header) */
    const uint8_t *p   = buf + 9;
    const uint8_t *end = buf + len;

    /* skip client_version (2) + random (32) */
    if (p + 34 > end) return -1;
    p += 34;

    /* skip session_id */
    if (p >= end) return -1;
    p += 1 + *p;

    /* skip cipher_suites */
    if (p + 2 > end) return -1;
    p += 2 + ((p[0] << 8) | p[1]);

    /* skip compression_methods */
    if (p >= end) return -1;
    p += 1 + *p;

    /* extensions */
    if (p + 2 > end) return -1;
    uint16_t ext_total = (uint16_t)((p[0] << 8) | p[1]);
    p += 2;
    const uint8_t *ext_end = p + ext_total;
    if (ext_end > end) ext_end = end;

    while (p + 4 <= ext_end) {
        uint16_t ext_type = (uint16_t)((p[0] << 8) | p[1]);
        uint16_t ext_dlen = (uint16_t)((p[2] << 8) | p[3]);
        p += 4;

        if (ext_type == 0x0000) {
            /* server_name extension */
            if (p + 5 > ext_end) return -1;
            /* server_name_list_length (2) */
            p += 2;
            /* name_type (1): 0x00 = host_name */
            if (*p != 0x00) return -1;
            p++;
            uint16_t name_len = (uint16_t)((p[0] << 8) | p[1]);
            p += 2;
            if (p + name_len > ext_end) return -1;
            if (name_len >= out_size) return -1;
            memcpy(out, p, name_len);
            out[name_len] = '\0';
            return 0;
        }
        p += ext_dlen;
    }
    return -1;
}

/* ── SOCKS5 handshake ─────────────────────────────────────────────── */
static int socks5_connect(int fd, const char *host, uint16_t port) {
    /* greeting: VER=5, NMETHODS=1, METHOD=0 (no auth) */
    uint8_t greet[] = {0x05, 0x01, 0x00};
    if (write(fd, greet, sizeof(greet)) != sizeof(greet)) return -1;

    uint8_t resp[2];
    if (read(fd, resp, 2) != 2) return -1;
    if (resp[0] != 0x05 || resp[1] != 0x00) return -1;   /* auth required? */

    /* CONNECT request: domain name */
    size_t hlen = strlen(host);
    if (hlen > 255) return -1;

    uint8_t req[4 + 1 + 255 + 2];
    req[0] = 0x05;          /* VER  */
    req[1] = 0x01;          /* CMD: CONNECT */
    req[2] = 0x00;          /* RSV  */
    req[3] = 0x03;          /* ATYP: domain name */
    req[4] = (uint8_t)hlen;
    memcpy(req + 5, host, hlen);
    req[5 + hlen]     = (uint8_t)(port >> 8);
    req[5 + hlen + 1] = (uint8_t)(port & 0xff);

    size_t req_len = 5 + hlen + 2;
    if ((size_t)write(fd, req, req_len) != req_len) return -1;

    /* response: VER RSV ATYP ... */
    uint8_t rep[10];
    if (read(fd, rep, 4) != 4) return -1;
    if (rep[0] != 0x05 || rep[1] != 0x00) return -1;

    /* skip bound address */
    if (rep[3] == 0x01) {
        if (read(fd, rep + 4, 4 + 2) != 6) return -1;
    } else if (rep[3] == 0x03) {
        uint8_t dlen;
        if (read(fd, &dlen, 1) != 1) return -1;
        uint8_t dummy[256 + 2];
        if (read(fd, dummy, dlen + 2) != dlen + 2) return -1;
    } else if (rep[3] == 0x04) {
        if (read(fd, rep + 4, 16 + 2) != 18) return -1;
    }
    return 0;
}

/* ── Bidirectional pipe ───────────────────────────────────────────── */
struct pipe_arg { int a, b; };

static void *pipe_thread(void *arg) {
    struct pipe_arg *pa = arg;
    uint8_t buf[BUF_SIZE];
    ssize_t n;
    while ((n = read(pa->a, buf, sizeof(buf))) > 0) {
        ssize_t total = 0;
        while (total < n) {
            ssize_t w = write(pa->b, buf + total, (size_t)(n - total));
            if (w <= 0) goto done;
            total += w;
        }
    }
done:
    shutdown(pa->b, SHUT_WR);
    free(pa);
    return NULL;
}

/* ── Per-connection handler ───────────────────────────────────────── */
static void *handle_conn(void *arg) {
    int client = (int)(intptr_t)arg;

    uint8_t peek[PEEK_BUF];
    ssize_t peeked = recv(client, peek, sizeof(peek), MSG_PEEK);
    if (peeked <= 0) { close(client); return NULL; }

    char sni[256];
    if (parse_sni(peek, peeked, sni, sizeof(sni)) != 0) {
        /* Not TLS or couldn't parse SNI — fallback: just proxy raw bytes */
        rlog("no SNI found, closing (fd=%d)", client);
        close(client);
        return NULL;
    }

    rlog("SNI=%s → socks5://%s:%d (fd=%d)", sni, g_socks5_host, g_socks5_port, client);

    /* Connect to SOCKS5 proxy */
    int proxy = socket(AF_INET, SOCK_STREAM, 0);
    if (proxy < 0) { rlog("socket: %s", strerror(errno)); close(client); return NULL; }

    struct sockaddr_in sa = {0};
    sa.sin_family = AF_INET;
    sa.sin_port   = htons((uint16_t)g_socks5_port);
    if (inet_pton(AF_INET, g_socks5_host, &sa.sin_addr) != 1) {
        struct hostent *he = gethostbyname(g_socks5_host);
        if (!he) { rlog("resolve proxy: %s", strerror(errno)); close(client); close(proxy); return NULL; }
        memcpy(&sa.sin_addr, he->h_addr, he->h_length);
    }

    if (connect(proxy, (struct sockaddr *)&sa, sizeof(sa)) < 0) {
        rlog("connect proxy: %s", strerror(errno));
        close(client); close(proxy); return NULL;
    }

    if (socks5_connect(proxy, sni, 443) < 0) {
        rlog("socks5 handshake failed for %s", sni);
        close(client); close(proxy); return NULL;
    }

    rlog("tunnel established → %s:443", sni);

    /* Consume the peeked bytes by reading normally, then forward to proxy */
    uint8_t first[PEEK_BUF];
    ssize_t first_n = recv(client, first, sizeof(first), 0);
    if (first_n > 0) {
        ssize_t sent = 0;
        while (sent < first_n) {
            ssize_t w = write(proxy, first + sent, (size_t)(first_n - sent));
            if (w <= 0) { close(client); close(proxy); return NULL; }
            sent += w;
        }
    }

    /* Bidirectional pipe */
    struct pipe_arg *p1 = malloc(sizeof(*p1));
    struct pipe_arg *p2 = malloc(sizeof(*p2));
    if (!p1 || !p2) {
        free(p1); free(p2);
        close(client); close(proxy);
        return NULL;
    }

    p1->a = client; p1->b = proxy;
    p2->a = proxy;  p2->b = client;

    pthread_t t;
    if (pthread_create(&t, NULL, pipe_thread, p2) != 0) {
        free(p1); free(p2);
        close(client); close(proxy);
        return NULL;
    }
    pthread_detach(t);

    /* Use current thread for client→proxy direction */
    pipe_thread(p1);
    return NULL;
}

/* ── Main ─────────────────────────────────────────────────────────── */
int main(int argc, char *argv[]) {
    if (argc > 1) g_relay_port  = atoi(argv[1]);
    if (argc > 2) { strncpy(g_socks5_host, argv[2], sizeof(g_socks5_host)-1); }
    if (argc > 3) g_socks5_port = atoi(argv[3]);

    signal(SIGPIPE, SIG_IGN);

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return 1; }

    int opt = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    setsockopt(srv, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt));

    struct sockaddr_in bind_addr = {0};
    bind_addr.sin_family      = AF_INET;
    bind_addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind_addr.sin_port        = htons((uint16_t)g_relay_port);

    if (bind(srv, (struct sockaddr *)&bind_addr, sizeof(bind_addr)) < 0) {
        perror("bind"); return 1;
    }
    if (listen(srv, 128) < 0) { perror("listen"); return 1; }

    fprintf(stderr, "\033[32m[relay]\033[0m listening on 127.0.0.1:%d"
                    "  →  socks5://%s:%d\n",
            g_relay_port, g_socks5_host, g_socks5_port);

    while (1) {
        struct sockaddr_in cli_addr;
        socklen_t cli_len = sizeof(cli_addr);
        int client = accept(srv, (struct sockaddr *)&cli_addr, &cli_len);
        if (client < 0) {
            if (errno == EINTR) continue;
            perror("accept"); break;
        }

        pthread_t t;
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        pthread_create(&t, &attr, handle_conn, (void *)(intptr_t)client);
        pthread_attr_destroy(&attr);
    }

    close(srv);
    return 0;
}
