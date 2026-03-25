#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <spawn.h>
#include <sys/time.h>
#include <pthread.h>
#include <stdarg.h>
#include <time.h>
#include <libgen.h>
#include <mach-o/dyld.h>

#include "fakeip.h"
#include "socks5.h"
#include "config.h"

#define DEFAULT_CONFIG_PATH "config.yaml"
#define LOG_FILE            "/tmp/antigravity-proxy.log"

/* ------------------------------------------------------------------ */
/* Logging                                                              */
/* ------------------------------------------------------------------ */

/* ANSI colors (stderr only) */
#define C_RESET  "\033[0m"
#define C_GRAY   "\033[90m"
#define C_GREEN  "\033[32m"
#define C_CYAN   "\033[36m"
#define C_YELLOW "\033[33m"
#define C_BLUE   "\033[34m"
#define C_RED    "\033[31m"
#define C_BOLD   "\033[1m"
#define C_MAGENTA "\033[35m"

static FILE *g_log_file = NULL;
static pthread_mutex_t g_log_mutex = PTHREAD_MUTEX_INITIALIZER;

/* Cache process name (basename of /proc/self/… equivalent) */
static char g_procname[64] = "?";

static void init_procname(void) {
    char path[1024] = {0};
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) == 0) {
        char *base = basename(path);
        if (base) strncpy(g_procname, base, sizeof(g_procname) - 1);
    }
}

static void log_open(void) {
    if (!g_log_file) {
        g_log_file = fopen(LOG_FILE, "a");
    }
}

/* ag_log(level_color, level_tag, fmt, ...) */
static void ag_log(const char *color, const char *tag, const char *fmt, ...)
    __attribute__((format(printf, 3, 4)));

static void ag_log(const char *color, const char *tag, const char *fmt, ...) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    struct tm tm;
    localtime_r(&ts.tv_sec, &tm);

    char timebuf[32];
    snprintf(timebuf, sizeof(timebuf), "%02d:%02d:%02d.%03ld",
             tm.tm_hour, tm.tm_min, tm.tm_sec, ts.tv_nsec / 1000000);

    pid_t pid  = getpid();
    pid_t ppid = getppid();

    va_list ap;

    /* ── stderr (colorized) ── */
    pthread_mutex_lock(&g_log_mutex);

    fprintf(stderr,
            C_GRAY "%s " C_RESET                  /* time        */
            "%s[%-7s]" C_RESET " "                /* level tag   */
            C_GRAY "(%s|%d←%d) " C_RESET,         /* proc|pid←ppid */
            timebuf, color, tag, g_procname, pid, ppid);

    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fprintf(stderr, "\n");

    /* ── log file (plain) ── */
    log_open();
    if (g_log_file) {
        fprintf(g_log_file,
                "%s [%-7s] (%s|%d<-%d) ",
                timebuf, tag, g_procname, pid, ppid);
        va_start(ap, fmt);
        vfprintf(g_log_file, fmt, ap);
        va_end(ap);
        fprintf(g_log_file, "\n");
        fflush(g_log_file);
    }

    pthread_mutex_unlock(&g_log_mutex);
}

/* Convenience macros */
#define LOG_INIT(...)    ag_log(C_BOLD C_GREEN,   "INIT",    __VA_ARGS__)
#define LOG_SPAWN(...)   ag_log(C_BOLD C_CYAN,    "SPAWN",   __VA_ARGS__)
#define LOG_EXEC(...)    ag_log(C_BOLD C_MAGENTA, "EXEC",    __VA_ARGS__)
#define LOG_DNS(...)     ag_log(C_BLUE,            "DNS",     __VA_ARGS__)
#define LOG_CONNECT(...) ag_log(C_YELLOW,          "CONNECT", __VA_ARGS__)
#define LOG_OK(...)      ag_log(C_GREEN,           "OK",      __VA_ARGS__)
#define LOG_ERR(...)     ag_log(C_RED,             "ERROR",   __VA_ARGS__)
#define LOG_SKIP(...)    ag_log(C_GRAY,            "SKIP",    __VA_ARGS__)

/* ------------------------------------------------------------------ */
/* Function pointer types                                              */
/* ------------------------------------------------------------------ */
typedef int (*connect_t)(int, const struct sockaddr*, socklen_t);
typedef int (*getaddrinfo_t)(const char*, const char*, const struct addrinfo*, struct addrinfo**);
typedef void (*freeaddrinfo_t)(struct addrinfo*);
typedef int (*posix_spawn_t)(pid_t*, const char*, const posix_spawn_file_actions_t*,
                             const posix_spawnattr_t*, char* const[], char* const[]);
typedef struct hostent* (*gethostbyname_t)(const char*);
typedef int (*execve_t)(const char*, char* const[], char* const[]);

static connect_t      real_connect      = NULL;
static getaddrinfo_t  real_getaddrinfo  = NULL;
static freeaddrinfo_t real_freeaddrinfo = NULL;
static posix_spawn_t  real_posix_spawn  = NULL;
static gethostbyname_t real_gethostbyname = NULL;
static execve_t       real_execve       = NULL;

extern char **environ;

static pthread_once_t init_once = PTHREAD_ONCE_INIT;

static void do_init(void) {
    real_connect       = (connect_t)dlsym(RTLD_NEXT, "connect");
    real_getaddrinfo   = (getaddrinfo_t)dlsym(RTLD_NEXT, "getaddrinfo");
    real_freeaddrinfo  = (freeaddrinfo_t)dlsym(RTLD_NEXT, "freeaddrinfo");
    real_posix_spawn   = (posix_spawn_t)dlsym(RTLD_NEXT, "posix_spawn");
    real_gethostbyname = (gethostbyname_t)dlsym(RTLD_NEXT, "gethostbyname");
    real_execve        = (execve_t)dlsym(RTLD_NEXT, "execve");

    init_procname();

    const char *cfg = getenv("ANTIGRAVITY_CONFIG");
    load_config(cfg ? cfg : DEFAULT_CONFIG_PATH);

    LOG_INIT("proxy=%s://%s:%d  log=" LOG_FILE,
             global_config.type[0] ? global_config.type : "socks5",
             global_config.host, global_config.port);
}

static void ensure_init(void) {
    pthread_once(&init_once, do_init);
}

__attribute__((constructor))
static void init_hooks(void) {
    ensure_init();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

static void apply_timeouts(int fd) {
    struct timeval tv;
    tv.tv_sec  = global_config.timeout_ms / 1000;
    tv.tv_usec = (global_config.timeout_ms % 1000) * 1000;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
}

static int connect_to_proxy(int fd) {
    struct sockaddr_in proxy_addr;
    memset(&proxy_addr, 0, sizeof(proxy_addr));
    proxy_addr.sin_family = AF_INET;
    proxy_addr.sin_port   = htons(global_config.port);
    if (inet_pton(AF_INET, global_config.host, &proxy_addr.sin_addr) != 1) {
        LOG_ERR("bad proxy host: %s", global_config.host);
        errno = EINVAL;
        return -1;
    }
    return real_connect(fd, (struct sockaddr *)&proxy_addr, sizeof(proxy_addr));
}

/* ------------------------------------------------------------------ */
/* Hook: connect()  — handles both AF_INET and AF_INET6               */
/* ------------------------------------------------------------------ */
int connect(int sockfd, const struct sockaddr *address, socklen_t address_len) {
    ensure_init();

    if (!address) return real_connect(sockfd, address, address_len);

    /* Only proxy TCP */
    int sock_type = 0;
    socklen_t optlen = sizeof(sock_type);
    getsockopt(sockfd, SOL_SOCKET, SO_TYPE, &sock_type, &optlen);
    if (sock_type != SOCK_STREAM) {
        return real_connect(sockfd, address, address_len);
    }

    /* ── AF_INET ── */
    if (address->sa_family == AF_INET) {
        const struct sockaddr_in *addr_in = (const struct sockaddr_in *)address;
        uint16_t target_port = ntohs(addr_in->sin_port);

        if (is_loopback_ipv4(addr_in->sin_addr) || is_private_ipv4(addr_in->sin_addr)) {
            /* Log loopback/private connections to 443 or known external ports for debugging */
            if (target_port == 443 || target_port == 80) {
                LOG_SKIP("local %s:%u (fd=%d)", inet_ntoa(addr_in->sin_addr), target_port, sockfd);
            }
            return real_connect(sockfd, address, address_len);
        }

        apply_timeouts(sockfd);

        const char *target_host = get_hostname_from_fake_ip(addr_in->sin_addr);
        const char *display_host = target_host ? target_host : inet_ntoa(addr_in->sin_addr);

        LOG_CONNECT("%s:%u  via %s:%d  (fd=%d, %s)",
                    display_host, target_port,
                    global_config.host, global_config.port,
                    sockfd, target_host ? "fakeip→domain" : "direct-ipv4");

        if (connect_to_proxy(sockfd) < 0) {
            LOG_ERR("proxy connect failed: %s", strerror(errno));
            return -1;
        }

        int rc = target_host
            ? socks5_handshake_domain(sockfd, target_host, target_port)
            : socks5_handshake_ipv4(sockfd, addr_in->sin_addr, target_port);

        if (rc < 0) {
            LOG_ERR("SOCKS5 handshake failed for %s:%u", display_host, target_port);
            return -1;
        }
        LOG_OK("tunnel established → %s:%u", display_host, target_port);
        return 0;
    }

    /* ── AF_INET6 — route via SOCKS5 using domain lookup from FakeIP,
       or fall back to raw IPv6 ATYP if no hostname mapping exists ── */
    if (address->sa_family == AF_INET6) {
        const struct sockaddr_in6 *addr6 = (const struct sockaddr_in6 *)address;
        uint16_t target_port = ntohs(addr6->sin6_port);

        /* Skip loopback ::1 and link-local */
        const uint8_t *b = addr6->sin6_addr.s6_addr;
        int is_loopback6 = (b[0]==0&&b[1]==0&&b[2]==0&&b[3]==0&&
                            b[4]==0&&b[5]==0&&b[6]==0&&b[7]==0&&
                            b[8]==0&&b[9]==0&&b[10]==0&&b[11]==0&&
                            b[12]==0&&b[13]==0&&b[14]==0&&b[15]==1);
        int is_linklocal6 = (b[0]==0xfe && (b[1]&0xc0)==0x80);
        if (is_loopback6 || is_linklocal6)
            return real_connect(sockfd, address, address_len);

        /* Check if this is an IPv4-mapped IPv6 address ::ffff:x.x.x.x */
        int is_v4mapped = (b[0]==0&&b[1]==0&&b[2]==0&&b[3]==0&&
                           b[4]==0&&b[5]==0&&b[6]==0&&b[7]==0&&
                           b[8]==0&&b[9]==0&&b[10]==0xff&&b[11]==0xff);

        char host_str[INET6_ADDRSTRLEN];
        inet_ntop(AF_INET6, &addr6->sin6_addr, host_str, sizeof(host_str));

        if (is_v4mapped) {
            /* Treat as IPv4 */
            struct in_addr v4 = { .s_addr = *(uint32_t *)(b + 12) };
            if (is_loopback_ipv4(v4) || is_private_ipv4(v4))
                return real_connect(sockfd, address, address_len);

            apply_timeouts(sockfd);
            const char *h = get_hostname_from_fake_ip(v4);
            LOG_CONNECT("[v4mapped] %s:%u  via %s:%d",
                        h ? h : inet_ntoa(v4), target_port,
                        global_config.host, global_config.port);
            if (connect_to_proxy(sockfd) < 0) { LOG_ERR("proxy connect failed: %s", strerror(errno)); return -1; }
            int rc = h ? socks5_handshake_domain(sockfd, h, target_port)
                       : socks5_handshake_ipv4(sockfd, v4, target_port);
            if (rc < 0) { LOG_ERR("SOCKS5 handshake failed [v4mapped] %s:%u", h?h:inet_ntoa(v4), target_port); return -1; }
            LOG_OK("tunnel established → %s:%u", h ? h : inet_ntoa(v4), target_port);
            return 0;
        }

        /* Pure IPv6 — proxy via SOCKS5 IPv6 ATYP (0x04) */
        apply_timeouts(sockfd);
        LOG_CONNECT("[ipv6] %s:%u  via %s:%d", host_str, target_port,
                    global_config.host, global_config.port);
        if (connect_to_proxy(sockfd) < 0) { LOG_ERR("proxy connect failed: %s", strerror(errno)); return -1; }
        int rc = socks5_handshake_ipv6(sockfd, addr6->sin6_addr, target_port);
        if (rc < 0) { LOG_ERR("SOCKS5 handshake failed [ipv6] %s:%u", host_str, target_port); return -1; }
        LOG_OK("tunnel established → [%s]:%u", host_str, target_port);
        return 0;
    }

    return real_connect(sockfd, address, address_len);
}

/* ------------------------------------------------------------------ */
/* Relay domain detection                                               */
/* Domains listed here are redirected to 127.0.0.1 (relay approach)   */
/* so that even pure-Go programs (using raw syscalls) get intercepted  */
/* via the pfctl rdr rule 127.0.0.1:443 → 127.0.0.1:RELAY_PORT.       */
/* ------------------------------------------------------------------ */
static int is_relay_domain(const char *hostname) {
    static const char *relay_suffixes[] = {
        ".googleapis.com",
        ".google.com",
        ".gstatic.com",
        ".googlevideo.com",
        ".googleusercontent.com",
        ".googleapis.com",
        "googleapis.com",
        "google.com",
        NULL
    };
    size_t hlen = strlen(hostname);
    for (int i = 0; relay_suffixes[i]; i++) {
        size_t slen = strlen(relay_suffixes[i]);
        if (hlen >= slen &&
            strcmp(hostname + hlen - slen, relay_suffixes[i]) == 0) {
            return 1;
        }
    }
    return 0;
}

/* Build a getaddrinfo result that points to a specific IPv4 address   */
static struct addrinfo *make_addrinfo(struct in_addr ip, uint16_t port,
                                      const struct addrinfo *hints,
                                      const char *canonname) {
    struct addrinfo    *info = calloc(1, sizeof(struct addrinfo));
    struct sockaddr_in *addr = calloc(1, sizeof(struct sockaddr_in));
    if (!info || !addr) { free(info); free(addr); return NULL; }
    addr->sin_family = AF_INET;
    addr->sin_addr   = ip;
    addr->sin_port   = htons(port);
    info->ai_family   = AF_INET;
    info->ai_socktype = hints ? hints->ai_socktype : SOCK_STREAM;
    info->ai_protocol = hints ? hints->ai_protocol : 0;
    info->ai_addr     = (struct sockaddr *)addr;
    info->ai_addrlen  = sizeof(struct sockaddr_in);
    if (canonname && hints && (hints->ai_flags & AI_CANONNAME))
        info->ai_canonname = strdup(canonname);
    return info;
}

/* ------------------------------------------------------------------ */
/* Hook: getaddrinfo()                                                  */
/* ------------------------------------------------------------------ */
int getaddrinfo(const char *hostname, const char *servname,
                const struct addrinfo *hints, struct addrinfo **res) {
    ensure_init();

    if (!hostname) return real_getaddrinfo(hostname, servname, hints, res);

    if (strcmp(hostname, "localhost") == 0 ||
        strcmp(hostname, "127.0.0.1") == 0 ||
        strcmp(hostname, "::1") == 0) {
        return real_getaddrinfo(hostname, servname, hints, res);
    }

    struct in_addr  test4;
    struct in6_addr test6;
    if (inet_pton(AF_INET,  hostname, &test4) == 1 ||
        inet_pton(AF_INET6, hostname, &test6) == 1) {
        return real_getaddrinfo(hostname, servname, hints, res);
    }

    if (hints && (hints->ai_flags & AI_NUMERICHOST)) {
        return real_getaddrinfo(hostname, servname, hints, res);
    }

    if (hints && hints->ai_socktype == SOCK_DGRAM) {
        return real_getaddrinfo(hostname, servname, hints, res);
    }

    uint16_t port = 0;
    if (servname) {
        int p = atoi(servname);
        if (p > 0) {
            port = (uint16_t)p;
        } else {
            if      (strcmp(servname, "https") == 0) port = 443;
            else if (strcmp(servname, "http")  == 0) port = 80;
            else if (strcmp(servname, "ftp")   == 0) port = 21;
            else if (strcmp(servname, "smtp")  == 0) port = 25;
            else if (strcmp(servname, "imap")  == 0) port = 143;
            else if (strcmp(servname, "imaps") == 0) port = 993;
            else {
                struct servent *se = getservbyname(servname, NULL);
                if (se) port = (uint16_t)ntohs(se->s_port);
            }
        }
    }

    /* For known Google API domains: return 127.0.0.1 so that pfctl's
     * rdr rule (127.0.0.1:443 → 127.0.0.1:RELAY_PORT) intercepts
     * the connection at the kernel level — works even for pure-Go
     * programs that use raw syscalls instead of libc connect().      */
    if (is_relay_domain(hostname)) {
        struct in_addr loopback;
        inet_pton(AF_INET, "127.0.0.1", &loopback);
        struct addrinfo *info = make_addrinfo(loopback, port, hints, hostname);
        if (!info) return EAI_MEMORY;
        LOG_DNS("%s → relay 127.0.0.1:%u (pfctl tunnel)", hostname, port);
        *res = info;
        return 0;
    }

    /* All other external hostnames: use FakeIP range + connect() hook */
    struct in_addr fake = get_fake_ip(hostname);
    if (fake.s_addr == 0) {
        LOG_ERR("fakeip table full, falling back for %s", hostname);
        return real_getaddrinfo(hostname, servname, hints, res);
    }

    LOG_DNS("%s → fakeip %s (port %u)", hostname, inet_ntoa(fake), port);

    struct addrinfo *info = make_addrinfo(fake, port, hints, hostname);
    if (!info) return EAI_MEMORY;
    *res = info;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Hook: freeaddrinfo()                                                 */
/* ------------------------------------------------------------------ */
void freeaddrinfo(struct addrinfo *ai) {
    ensure_init();
    if (!ai) return;

    struct addrinfo *cur = ai;
    while (cur) {
        struct addrinfo *next = cur->ai_next;

        bool our_alloc = false;
        if (cur->ai_addr && cur->ai_family == AF_INET) {
            struct sockaddr_in *sin = (struct sockaddr_in *)cur->ai_addr;
            struct in_addr base;
            inet_pton(AF_INET, FAKE_IP_BASE, &base);
            uint32_t base_ip = ntohl(base.s_addr);
            uint32_t this_ip = ntohl(sin->sin_addr.s_addr);
            if (this_ip >= base_ip && this_ip < base_ip + MAX_MAPPINGS)
                our_alloc = true;
        }

        if (our_alloc) {
            free(cur->ai_addr);
            free(cur->ai_canonname);
            free(cur);
        } else {
            cur->ai_next = NULL;
            real_freeaddrinfo(cur);
        }
        cur = next;
    }
}

/* ------------------------------------------------------------------ */
/* Hook: gethostbyname()                                               */
/* ------------------------------------------------------------------ */
struct hostent* gethostbyname(const char *name) {
    ensure_init();
    if (!name || strcmp(name, "localhost") == 0 || strcmp(name, "127.0.0.1") == 0)
        return real_gethostbyname(name);

    struct in_addr test;
    if (inet_pton(AF_INET, name, &test) == 1)
        return real_gethostbyname(name);

    static __thread struct hostent  h;
    static __thread char           *addr_list[2];
    static __thread struct in_addr  addr;

    addr = get_fake_ip(name);
    if (addr.s_addr == 0) return real_gethostbyname(name);

    LOG_DNS("gethostbyname: %s → fakeip %s", name, inet_ntoa(addr));

    addr_list[0] = (char *)&addr;
    addr_list[1] = NULL;

    h.h_name      = (char *)name;
    h.h_aliases   = NULL;
    h.h_addrtype  = AF_INET;
    h.h_length    = sizeof(struct in_addr);
    h.h_addr_list = addr_list;

    return &h;
}

/* ------------------------------------------------------------------ */
/* Shared helper: build env array with injected proxy/DYLD vars       */
/* src_env may be NULL → falls back to process environ.               */
/* ------------------------------------------------------------------ */
static char **build_injected_env(char *const src_env[]) {
    const char *dylib_path = NULL;
    Dl_info dlinfo;
    if (dladdr((void *)build_injected_env, &dlinfo))
        dylib_path = dlinfo.dli_fname;

    char proxy_url[320];
    snprintf(proxy_url, sizeof(proxy_url), "%s://%s:%d",
             global_config.type[0] ? global_config.type : "socks5",
             global_config.host, global_config.port);

    struct { const char *key; const char *val; } inject[] = {
        { "DYLD_INSERT_LIBRARIES", dylib_path  },
        { "ALL_PROXY",             proxy_url   },
        { "HTTPS_PROXY",           proxy_url   },
        { "HTTP_PROXY",            proxy_url   },
        { "ANTIGRAVITY_CONFIG",    getenv("ANTIGRAVITY_CONFIG") },
    };
    int n_inject = (int)(sizeof(inject) / sizeof(inject[0]));

    char *const *base = src_env ? src_env : (char *const *)environ;
    if (!base) return NULL;

    int env_count = 0;
    while (base[env_count]) env_count++;

    char **new_env = malloc(sizeof(char *) * (size_t)(env_count + n_inject + 1));
    if (!new_env) return NULL;

    bool injected[sizeof(inject)/sizeof(inject[0])];
    memset(injected, 0, sizeof(injected));
    int j = 0;

    for (int i = 0; i < env_count; i++) {
        bool replaced = false;
        for (int k = 0; k < n_inject; k++) {
            if (!inject[k].val) continue;
            size_t klen = strlen(inject[k].key);
            if (strncmp(base[i], inject[k].key, klen) == 0 && base[i][klen] == '=') {
                char *entry = NULL;
                asprintf(&entry, "%s=%s", inject[k].key, inject[k].val);
                new_env[j++] = entry;
                injected[k]  = true;
                replaced     = true;
                break;
            }
        }
        if (!replaced) new_env[j++] = base[i];
    }

    for (int k = 0; k < n_inject; k++) {
        if (!injected[k] && inject[k].val) {
            char *entry = NULL;
            asprintf(&entry, "%s=%s", inject[k].key, inject[k].val);
            new_env[j++] = entry;
        }
    }
    new_env[j] = NULL;
    return new_env;
}

static void free_injected_env(char **new_env, char *const src_env[]) {
    if (!new_env) return;
    char *const *base = src_env ? src_env : (char *const *)environ;
    int orig_count = 0;
    if (base) while (base[orig_count]) orig_count++;

    for (int i = 0; new_env[i]; i++) {
        bool is_orig = false;
        for (int o = 0; o < orig_count; o++) {
            if (base && new_env[i] == base[o]) { is_orig = true; break; }
        }
        if (!is_orig) free(new_env[i]);
    }
    free(new_env);
}

/* ------------------------------------------------------------------ */
/* Hook: posix_spawn() — child process injection                       */
/* ------------------------------------------------------------------ */
int posix_spawn(pid_t *pid, const char *path,
                const posix_spawn_file_actions_t *file_actions,
                const posix_spawnattr_t *attrp,
                char *const argv[], char *const envp[]) {
    ensure_init();

    if (!global_config.child_injection)
        return real_posix_spawn(pid, path, file_actions, attrp, argv, envp);

    /* basename for display */
    char pathcopy[256];
    strncpy(pathcopy, path ? path : "", sizeof(pathcopy)-1);
    LOG_SPAWN("posix_spawn → %s  (envp=%s)",
              basename(pathcopy), envp ? "provided" : "NULL(inherit)");

    char **new_env = build_injected_env(envp);
    if (!new_env)
        return real_posix_spawn(pid, path, file_actions, attrp, argv, envp);

    int rc = real_posix_spawn(pid, path, file_actions, attrp, argv, new_env);
    if (rc == 0 && pid)
        LOG_OK("posix_spawn child pid=%d  path=%s", (int)*pid, path ? path : "?");
    else if (rc != 0)
        LOG_ERR("posix_spawn failed rc=%d  path=%s", rc, path ? path : "?");

    free_injected_env(new_env, envp);
    return rc;
}

/* ------------------------------------------------------------------ */
/* Hook: execve() — catches fork+exec child launches (Electron)       */
/* ------------------------------------------------------------------ */
int execve(const char *path, char *const argv[], char *const envp[]) {
    ensure_init();

    if (!global_config.child_injection)
        return real_execve(path, argv, envp);

    /* Skip system binaries */
    if (path &&
        (strncmp(path, "/usr/bin/",  9) == 0 ||
         strncmp(path, "/bin/",      5) == 0 ||
         strncmp(path, "/sbin/",     6) == 0 ||
         strncmp(path, "/System/",   8) == 0 ||
         strncmp(path, "/usr/sbin/",10) == 0)) {
        return real_execve(path, argv, envp);
    }

    char pathcopy[256];
    strncpy(pathcopy, path ? path : "", sizeof(pathcopy)-1);
    LOG_EXEC("execve → %s", basename(pathcopy));

    char **new_env = build_injected_env(envp);
    if (!new_env)
        return real_execve(path, argv, envp);

    int rc = real_execve(path, argv, new_env);
    /* execve only returns on failure */
    LOG_ERR("execve failed rc=%d  errno=%s  path=%s", rc, strerror(errno), path ? path : "?");
    free_injected_env(new_env, envp);
    return rc;
}
