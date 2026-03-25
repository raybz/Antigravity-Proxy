#ifndef FAKEIP_H
#define FAKEIP_H

#include <stdint.h>
#include <string.h>
#include <stdbool.h>
#include <arpa/inet.h>
#include <pthread.h>

#define MAX_MAPPINGS 4096
#define FAKE_IP_BASE "198.18.0.1"

typedef struct {
    char hostname[256];
    struct in_addr fake_ip;
} IpMapping;

static IpMapping mappings[MAX_MAPPINGS];
static int mapping_count = 0;
static uint32_t next_ip_idx = 0;
static pthread_mutex_t fakeip_mutex = PTHREAD_MUTEX_INITIALIZER;

static inline struct in_addr get_fake_ip(const char* hostname) {
    pthread_mutex_lock(&fakeip_mutex);

    for (int i = 0; i < mapping_count; i++) {
        if (strcmp(mappings[i].hostname, hostname) == 0) {
            struct in_addr result = mappings[i].fake_ip;
            pthread_mutex_unlock(&fakeip_mutex);
            return result;
        }
    }

    struct in_addr result = {0};
    if (mapping_count < MAX_MAPPINGS) {
        strncpy(mappings[mapping_count].hostname, hostname, 255);
        mappings[mapping_count].hostname[255] = '\0';
        struct in_addr base;
        inet_pton(AF_INET, FAKE_IP_BASE, &base);
        uint32_t ip_val = ntohl(base.s_addr) + next_ip_idx++;
        mappings[mapping_count].fake_ip.s_addr = htonl(ip_val);
        result = mappings[mapping_count].fake_ip;
        mapping_count++;
    }

    pthread_mutex_unlock(&fakeip_mutex);
    return result;
}

static inline const char* get_hostname_from_fake_ip(struct in_addr fake_ip) {
    pthread_mutex_lock(&fakeip_mutex);
    for (int i = 0; i < mapping_count; i++) {
        if (mappings[i].fake_ip.s_addr == fake_ip.s_addr) {
            const char* result = mappings[i].hostname;
            pthread_mutex_unlock(&fakeip_mutex);
            return result;
        }
    }
    pthread_mutex_unlock(&fakeip_mutex);
    return NULL;
}

/* Returns 1 if addr is a loopback or link-local address that should bypass proxy */
static inline int is_loopback_ipv4(struct in_addr addr) {
    uint32_t ip = ntohl(addr.s_addr);
    return (ip >> 24) == 127;
}

/* Returns 1 if addr is RFC-1918 private / link-local (should bypass proxy) */
static inline int is_private_ipv4(struct in_addr addr) {
    uint32_t ip = ntohl(addr.s_addr);
    if ((ip >> 24) == 10)                          return 1; /* 10/8     */
    if ((ip >> 20) == (172 << 4 | 1))              return 1; /* 172.16/12 */
    if ((ip >> 16) == (192 << 8 | 168))            return 1; /* 192.168/16 */
    if ((ip >> 16) == (169 << 8 | 254))            return 1; /* 169.254/16 link-local */
    if ((ip >> 24) == 127)                         return 1; /* 127/8 loopback */
    /* FakeIP range 198.18.0.0/15 — these are our own, not proxy targets */
    if ((ip >> 17) == (198 << 1 | 0) && ((ip >> 16) & 0xFF) >= 18 && ((ip >> 16) & 0xFF) <= 19)
        return 1;
    return 0;
}

#endif
