#ifndef CONFIG_H
#define CONFIG_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

typedef struct {
    char host[256];
    int  port;
    int  timeout_ms;
    bool child_injection;
    char type[16];   /* "socks5" or "http" */
} Config;

static Config global_config = {
    .host            = "127.0.0.1",
    .port            = 1080,
    .timeout_ms      = 5000,
    .child_injection = true,
    .type            = "socks5"
};

static inline bool is_line_key(const char* line, const char* key) {
    const char* p = line;
    while (*p == ' ' || *p == '\t') p++; // 跳过前导空格
    size_t klen = strlen(key);
    return (strncmp(p, key, klen) == 0 && p[klen] == ':');
}

static inline void load_config(const char* path) {
    FILE* f = fopen(path, "r");
    if (!f) {
        fprintf(stderr, "[Antigravity] Config file not found at %s, using defaults.\n", path);
        return;
    }

    char line[512];
    while (fgets(line, sizeof(line), f)) {
        if (is_line_key(line, "host")) {
            char* val = strchr(line, ':') + 1;
            while (*val == ' ' || *val == '"') val++;
            char* end = val + strlen(val) - 1;
            while (end >= val && (*end == ' ' || *end == '\n' || *end == '\r' || *end == '"')) *end-- = '\0';
            strncpy(global_config.host, val, 255);
        } else if (is_line_key(line, "port")) {
            char* val = strchr(line, ':') + 1;
            global_config.port = atoi(val);
        } else if (is_line_key(line, "timeout")) {
            char* val = strchr(line, ':') + 1;
            global_config.timeout_ms = atoi(val);
        } else if (is_line_key(line, "child_injection")) {
            char* val = strchr(line, ':') + 1;
            while (*val == ' ') val++;
            global_config.child_injection = (strncmp(val, "true", 4) == 0);
        } else if (is_line_key(line, "type")) {
            char* val = strchr(line, ':') + 1;
            while (*val == ' ' || *val == '"') val++;
            char* end = val + strlen(val) - 1;
            while (end >= val && (*end == ' ' || *end == '\n' || *end == '\r' || *end == '"')) *end-- = '\0';
            strncpy(global_config.type, val, sizeof(global_config.type) - 1);
        }
    }
    fclose(f);
}

#endif
