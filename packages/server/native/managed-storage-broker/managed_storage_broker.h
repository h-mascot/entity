#ifndef MANAGED_STORAGE_BROKER_H
#define MANAGED_STORAGE_BROKER_H

#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

#define MSB_MAX_PATH 4096U
#define MSB_MAX_IO (1024U * 1024U)

typedef void (*msb_before_replace_fn)(void *context);
typedef struct {
  int root_fd;
  msb_before_replace_fn before_replace;
  void *before_replace_context;
} msb_broker;
typedef struct { uint64_t size; uint32_t mode; int is_directory; } msb_stat;
typedef struct { char *data; size_t length; } msb_listing;

enum msb_status { MSB_OK = 0, MSB_INVALID = -1, MSB_NOT_FOUND = -2, MSB_IO = -3, MSB_EXISTS = -4, MSB_LIMIT = -5 };

int msb_open(msb_broker *broker, const char *root);
void msb_close(msb_broker *broker);
int msb_stat_path(const msb_broker *broker, const char *path, msb_stat *out);
int msb_read(const msb_broker *broker, const char *path, uint8_t *out, size_t capacity, size_t *length);
int msb_write(const msb_broker *broker, const char *path, const uint8_t *data, size_t length, int exclusive);
int msb_replace_if_equal(const msb_broker *broker, const char *path, const char *recovery_path,
                         const uint8_t *expected, size_t expected_length,
                         const uint8_t *replacement, size_t replacement_length);
int msb_mkdir(const msb_broker *broker, const char *path, mode_t mode);
int msb_list(const msb_broker *broker, const char *path, msb_listing *out);
void msb_free_list(msb_listing *list);
int msb_protocol_validate(const uint8_t *request, size_t length);

#endif
