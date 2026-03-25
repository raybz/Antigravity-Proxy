#ifndef SOCKS5_H
#define SOCKS5_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <errno.h>

#define SOCKS5_VER        0x05
#define SOCKS5_CMD_CONNECT 0x01
#define SOCKS5_RSV        0x00
#define SOCKS5_ATYP_IPV4  0x01
#define SOCKS5_ATYP_DOMAIN 0x03
#define SOCKS5_ATYP_IPV6  0x04

/* recv() that retries on EINTR and ensures all 'n' bytes are read */
static inline int recv_all(int fd, unsigned char *buf, int n) {
    int total = 0;
    while (total < n) {
        int r = (int)recv(fd, buf + total, (size_t)(n - total), MSG_WAITALL);
        if (r <= 0) {
            if (r < 0 && errno == EINTR) continue;
            return -1;
        }
        total += r;
    }
    return total;
}

/* Drain the SOCKS5 CONNECT response and verify success.
   Response: VER(1) REP(1) RSV(1) ATYP(1) BND.ADDR(variable) BND.PORT(2) */
static inline int socks5_drain_response(int fd) {
    unsigned char hdr[4];
    if (recv_all(fd, hdr, 4) != 4) return -1;
    if (hdr[0] != SOCKS5_VER) return -1;
    if (hdr[1] != 0x00) {
        fprintf(stderr, "[Antigravity] SOCKS5 error reply: 0x%02x\n", hdr[1]);
        return -1;
    }

    unsigned char tail[256 + 2];
    int tail_len = 0;

    switch (hdr[3]) {
        case SOCKS5_ATYP_IPV4:
            tail_len = 4 + 2; /* IPv4(4) + port(2) */
            break;
        case SOCKS5_ATYP_IPV6:
            tail_len = 16 + 2; /* IPv6(16) + port(2) */
            break;
        case SOCKS5_ATYP_DOMAIN: {
            unsigned char domain_len;
            if (recv_all(fd, &domain_len, 1) != 1) return -1;
            tail_len = domain_len + 2; /* domain + port(2) */
            break;
        }
        default:
            return -1;
    }

    if (recv_all(fd, tail, tail_len) != tail_len) return -1;
    return 0;
}

/* SOCKS5 handshake: target specified as domain name */
static inline int socks5_handshake_domain(int fd, const char* remote_host, uint16_t remote_port) {
    unsigned char buf[512];

    /* 1. Method negotiation: offer NO AUTH */
    buf[0] = SOCKS5_VER;
    buf[1] = 0x01;
    buf[2] = 0x00;
    if (send(fd, buf, 3, 0) != 3) return -1;

    if (recv_all(fd, buf, 2) != 2) return -1;
    if (buf[0] != SOCKS5_VER || buf[1] != 0x00) return -1;

    /* 2. CONNECT request */
    int host_len = (int)strlen(remote_host);
    if (host_len > 255) return -1;

    buf[0] = SOCKS5_VER;
    buf[1] = SOCKS5_CMD_CONNECT;
    buf[2] = SOCKS5_RSV;
    buf[3] = SOCKS5_ATYP_DOMAIN;
    buf[4] = (unsigned char)host_len;
    memcpy(buf + 5, remote_host, (size_t)host_len);
    uint16_t port_net = htons(remote_port);
    memcpy(buf + 5 + host_len, &port_net, 2);

    int req_len = 7 + host_len;
    if (send(fd, buf, (size_t)req_len, 0) != req_len) return -1;

    /* 3. Read and drain full response */
    return socks5_drain_response(fd);
}

/* SOCKS5 handshake: target specified as raw IPv6 address (ATYP 0x04) */
static inline int socks5_handshake_ipv6(int fd, struct in6_addr addr, uint16_t remote_port) {
    unsigned char buf[32];

    buf[0] = SOCKS5_VER;
    buf[1] = 0x01;
    buf[2] = 0x00;
    if (send(fd, buf, 3, 0) != 3) return -1;

    if (recv_all(fd, buf, 2) != 2) return -1;
    if (buf[0] != SOCKS5_VER || buf[1] != 0x00) return -1;

    buf[0] = SOCKS5_VER;
    buf[1] = SOCKS5_CMD_CONNECT;
    buf[2] = SOCKS5_RSV;
    buf[3] = SOCKS5_ATYP_IPV6;
    memcpy(buf + 4, addr.s6_addr, 16);
    uint16_t port_net = htons(remote_port);
    memcpy(buf + 20, &port_net, 2);

    if (send(fd, buf, 22, 0) != 22) return -1;

    return socks5_drain_response(fd);
}

/* SOCKS5 handshake: target specified as raw IPv4 address */
static inline int socks5_handshake_ipv4(int fd, struct in_addr addr, uint16_t remote_port) {
    unsigned char buf[32];

    buf[0] = SOCKS5_VER;
    buf[1] = 0x01;
    buf[2] = 0x00;
    if (send(fd, buf, 3, 0) != 3) return -1;

    if (recv_all(fd, buf, 2) != 2) return -1;
    if (buf[0] != SOCKS5_VER || buf[1] != 0x00) return -1;

    buf[0] = SOCKS5_VER;
    buf[1] = SOCKS5_CMD_CONNECT;
    buf[2] = SOCKS5_RSV;
    buf[3] = SOCKS5_ATYP_IPV4;
    memcpy(buf + 4, &addr.s_addr, 4);
    uint16_t port_net = htons(remote_port);
    memcpy(buf + 8, &port_net, 2);

    if (send(fd, buf, 10, 0) != 10) return -1;

    return socks5_drain_response(fd);
}

#endif
