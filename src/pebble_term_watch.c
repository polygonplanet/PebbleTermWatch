/*
 * Pebble Term Watch
 *
 * Pebble watchface for SDK 2
 * https://github.com/polygonplanet/PebbleTermWatch
 *
 * based:
 *  CMD Time Typed: https://github.com/C-D-Lewis/cmd-time-typed
 *  91 Dub v2.0: https://github.com/orviwan/91-Dub-v2.0
 */
#include <pebble.h>

#define TYPE_DELTA (200)
#define PROMPT_DELTA (1000)
#define MARQUEE_DELTA (500)
#define SETTINGS_KEY (262)

static AppSync sync;
static uint8_t sync_buffer[128];

// layers
static Window *window;
static Layer *window_layer;

static TextLayer *time_label, *time_layer,
                 *date_label, *date_layer,
                 *hour_label, *hour_layer,
                 *prompt_label;

static InverterLayer *prompt_layer;

static TextLayer *feed_label, *feed_layer;

static AppTimer *timer;

typedef struct persist {
  uint8_t BluetoothVibe;
  uint8_t TypingAnimation;
  int16_t TimezoneOffset;
  uint8_t FeedEnabled;
} __attribute__((__packed__)) persist;

persist settings = {
  .BluetoothVibe = 1,
  .TypingAnimation = 1,
  .TimezoneOffset = 0,
  .FeedEnabled = 0
};

enum {
  BLUETOOTH_VIBE_KEY = 0x0,
  TYPING_ANIMATION_KEY = 0x1,
  TIMEZONE_OFFSET_KEY = 0x2,
  FEED_ENABLED_KEY = 0x3,
  FEED_URL_KEY = 0x4,
  MSG_TYPE_KEY = 0x5,
  FEED_TITLE_KEY = 0x6
};

static bool appStarted = false;
static uint8_t prevFeedEnabled = (uint8_t)0;

#define INITTIME_PROMPT_LIMIT (30)
static bool firstRun = true;
static int initTime = 1;
static int startTime = 0;
static bool timerRegistered = false;

static bool reset_next_tick = false;

// bluetooth
static GBitmap *bluetooth_image;
static BitmapLayer *bluetooth_layer;

// battery
static uint8_t batteryPercent;
static GBitmap *battery_image;
static BitmapLayer *battery_image_layer;
static BitmapLayer *battery_layer;

static GBitmap *background_image;
static BitmapLayer *background_layer;

static GBitmap *branding_mask_image;
static BitmapLayer *branding_mask_layer;

// battery percent (XX% - XXX%)
#define TOTAL_BATTERY_PERCENT_DIGITS (4)
static GBitmap *battery_percent_image[TOTAL_BATTERY_PERCENT_DIGITS];
static BitmapLayer *battery_percent_layers[TOTAL_BATTERY_PERCENT_DIGITS];

const int TINY_IMAGE_RESOURCE_IDS[] = {
  RESOURCE_ID_IMAGE_TINY_0,
  RESOURCE_ID_IMAGE_TINY_1,
  RESOURCE_ID_IMAGE_TINY_2,
  RESOURCE_ID_IMAGE_TINY_3,
  RESOURCE_ID_IMAGE_TINY_4,
  RESOURCE_ID_IMAGE_TINY_5,
  RESOURCE_ID_IMAGE_TINY_6,
  RESOURCE_ID_IMAGE_TINY_7,
  RESOURCE_ID_IMAGE_TINY_8,
  RESOURCE_ID_IMAGE_TINY_9,
  RESOURCE_ID_IMAGE_TINY_PERCENT
};

// Feeds
#define MSG_TYPE_FEED_FETCHED ((uint8_t)4)
#define MSG_TYPE_FEED_TITLE_START ((uint8_t)5)
#define MSG_TYPE_FEED_TITLE_END ((uint8_t)6)

// time until to start marquee (seconds)
#define FEED_WAIT_TIME_LIMIT (5)

// time to request feed (seconds)
#define FEED_WAIT_TIME_LIMIT_LONG (15)

// maximum length to append feed title
#define FEED_MAX_TITLE_LEN (140)
#define FEED_TITLE_CHUNK_SIZE (17)
#define FEED_TITLE_APPEND_MAX (8)

static char feed_title[FEED_TITLE_CHUNK_SIZE];
static char feed_prev_title[FEED_TITLE_CHUNK_SIZE];
static char feed_buffer[192];

static int feed_index;
static int feed_lastindex;

static bool feed_title_ready = false;
static bool feed_title_sending = false;
static bool can_fetch_feed = false;

static bool feed_marquee_animating = false;
static bool feed_marquee_animated = false;

static int feed_wait_time = FEED_WAIT_TIME_LIMIT;
static int feed_append_len = 0;

static bool feed_fetched = false;
static bool feed_enabled_initialized = false;

static int feed_enabled_init_count = 2;
static bool feed_enabled_reload_locked = false;

// Buffers
//TODO: Display day ("Sun", "Mon" ...)
static char date_buffer[] = "XXXX-XX-XX",
            hour_buffer[] = "XX:XX:XX",
            // unixtime ("0" - "2147483647"?)
            time_buffer[] = "XXXXXXXXXXXXXXX";

// State
static int state = 0;
static bool prompt_visible = false;

// Prototypes
static TextLayer* cl_init_text_layer(GRect location,
                                     GColor colour,
                                     GColor background,
                                     ResHandle handle,
                                     GTextAlignment alignment);

static void set_container_image(GBitmap **bmp_image,
                                BitmapLayer *bmp_layer,
                                const int resource_id,
                                GPoint origin) {

  GBitmap *old_image = *bmp_image;
  *bmp_image = gbitmap_create_with_resource(resource_id);

  GRect frame = (GRect) {
    .origin = origin,
    .size = (*bmp_image)->bounds.size
  };
  bitmap_layer_set_bitmap(bmp_layer, *bmp_image);
  layer_set_frame(bitmap_layer_get_layer(bmp_layer), frame);

  if (old_image != NULL) {
    gbitmap_destroy(old_image);
    old_image = NULL;
  }
}

void change_background() {
  gbitmap_destroy(background_image);
  gbitmap_destroy(branding_mask_image);

  //XXX: settings.Invert
  background_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BACKGROUND);
  branding_mask_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BRANDING_MASK);

  bitmap_layer_set_bitmap(branding_mask_layer, branding_mask_image);
  layer_mark_dirty(bitmap_layer_get_layer(branding_mask_layer));

  bitmap_layer_set_bitmap(background_layer, background_image);
  layer_mark_dirty(bitmap_layer_get_layer(background_layer));
}


void change_battery_icon(bool charging) {
  gbitmap_destroy(battery_image);

  if (charging) {
    battery_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BATTERY_CHARGE);
  } else {
    battery_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BATTERY);
  }
  bitmap_layer_set_bitmap(battery_image_layer, battery_image);
  layer_mark_dirty(bitmap_layer_get_layer(battery_image_layer));
}

// battery
static void update_battery(BatteryChargeState charge_state) {
  batteryPercent = charge_state.charge_percent;

  if (batteryPercent == 100) {
    change_battery_icon(false);
    layer_set_hidden(bitmap_layer_get_layer(battery_layer), false);

    for (int i = 0; i < TOTAL_BATTERY_PERCENT_DIGITS; ++i) {
      layer_set_hidden(bitmap_layer_get_layer(battery_percent_layers[i]), false);
    }

    set_container_image(&battery_percent_image[0],
                        battery_percent_layers[0],
                        TINY_IMAGE_RESOURCE_IDS[1],
                        GPoint(93, 6));

    set_container_image(&battery_percent_image[1],
                        battery_percent_layers[1],
                        TINY_IMAGE_RESOURCE_IDS[0],
                        GPoint(99, 6));

    set_container_image(&battery_percent_image[2],
                        battery_percent_layers[2],
                        TINY_IMAGE_RESOURCE_IDS[0],
                        GPoint(105, 6));

    set_container_image(&battery_percent_image[3],
                        battery_percent_layers[3],
                        TINY_IMAGE_RESOURCE_IDS[10],
                        GPoint(111, 7));
    return;
  }

  layer_set_hidden(bitmap_layer_get_layer(battery_layer), charge_state.is_charging);
  change_battery_icon(charge_state.is_charging);

  layer_set_hidden(bitmap_layer_get_layer(battery_percent_layers[0]), true);
  for (int i = 1; i < TOTAL_BATTERY_PERCENT_DIGITS; ++i) {
    layer_set_hidden(bitmap_layer_get_layer(battery_percent_layers[i]), false);
  }

  set_container_image(&battery_percent_image[1],
                      battery_percent_layers[1],
                      TINY_IMAGE_RESOURCE_IDS[charge_state.charge_percent / 10],
                      GPoint(99, 6));

  set_container_image(&battery_percent_image[2],
                      battery_percent_layers[2],
                      TINY_IMAGE_RESOURCE_IDS[charge_state.charge_percent % 10],
                      GPoint(105, 6));

  set_container_image(&battery_percent_image[3],
                      battery_percent_layers[3],
                      TINY_IMAGE_RESOURCE_IDS[10],
                      GPoint(111, 7));
}

void battery_layer_update_callback(Layer *me, GContext* ctx) {
  // draw the remaining battery percentage
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx,
    GRect(2, 2, ((batteryPercent / 100.0) * 11.0), 5), 0, GCornerNone);
}

// bluetooth
static void toggle_bluetooth_icon(bool connected) {
  if (appStarted && !connected && settings.BluetoothVibe) {
    // vibe on bluetooth disconnect
    vibes_long_pulse();
  }
  layer_set_hidden(bitmap_layer_get_layer(bluetooth_layer), !connected);
}

void bluetooth_connection_callback(bool connected) {
  toggle_bluetooth_icon(connected);
}

// time lifecycle
static void set_time(struct tm *t) {
  // date
  if (clock_is_24h_style()) {
    strftime(hour_buffer, sizeof("XX:XX:XX"),"%H:%M:%S", t);
  } else {
    strftime(hour_buffer, sizeof("XX:XX:XX"),"%I:%M:%S", t);
  }
  text_layer_set_text(hour_layer, hour_buffer);

  strftime(date_buffer, sizeof("XXXX-XX-XX"), "%Y-%m-%d", t);
  text_layer_set_text(date_layer, date_buffer);

  // unixtime
  // Pebble SDK 2 can't get timezone offset(?)
  snprintf(time_buffer, sizeof("XXXXXXXXXXXXXXX"), "%u",
           (unsigned)time(NULL) + settings.TimezoneOffset);
  text_layer_set_text(time_layer, time_buffer);
}

static void update_time() {
  // Time structures
  time_t ts = time(NULL);
  struct tm *t = localtime(&ts);
  set_time(t);

  if (startTime == 0) {
    startTime = ts;
  }
}

// feed animation
static void marquee_feed_title_reset(void) {
  if (!settings.FeedEnabled) {
    return;
  }

  if (feed_title_ready) {
    feed_index = 0;
    feed_wait_time = FEED_WAIT_TIME_LIMIT;

    strncpy(feed_title, feed_buffer + feed_index, 17);
    text_layer_set_text(feed_layer, feed_title);
    feed_marquee_animating = false;
  }
}

static void marquee_feed_title(void) {
  if (!settings.FeedEnabled || feed_enabled_reload_locked) {
    return;
  }

  if (feed_title_ready) {
    if (--feed_wait_time >= 0) {
      feed_marquee_animating = false;
      return;
    }

    feed_wait_time = 0;

    if (++feed_index == feed_lastindex) {
      feed_index = 0;
      feed_wait_time = FEED_WAIT_TIME_LIMIT;
      feed_marquee_animating = false;
    }

    if (feed_title_ready) {
      strncpy(feed_title, feed_buffer + feed_index, 17);
      text_layer_set_text(feed_layer, feed_title);
      feed_marquee_animating = true;
    }
  }
}

static void set_time_anim() {
  // frame animation
  switch (state) {
    case 0:
      update_time();
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 1:
      text_layer_set_text(date_label, "pebble>d");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 2:
      text_layer_set_text(date_label, "pebble>da");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 3:
      text_layer_set_text(date_label, "pebble>dat");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 4:
      text_layer_set_text(date_label, "pebble>date");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 5:
      text_layer_set_text(date_label, "pebble>date +");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 6:
      text_layer_set_text(date_label, "pebble>date +%");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 7:
      text_layer_set_text(date_label, "pebble>date +%F");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 8:
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(date_layer));
      text_layer_set_text(hour_label, "pebble>");
      timer = app_timer_register(5 * TYPE_DELTA, set_time_anim, 0);
      break;
    case 9:
      text_layer_set_text(hour_label, "pebble>d");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 10:
      text_layer_set_text(hour_label, "pebble>da");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 11:
      text_layer_set_text(hour_label, "pebble>dat");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 12:
      text_layer_set_text(hour_label, "pebble>date");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 13:
      text_layer_set_text(hour_label, "pebble>date +");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 14:
      text_layer_set_text(hour_label, "pebble>date +%");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 15:
      text_layer_set_text(hour_label, "pebble>date +%T");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 16:
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(hour_layer));
      text_layer_set_text(time_label, "pebble>");
      timer = app_timer_register(5 * TYPE_DELTA, set_time_anim, 0);
      break;
    case 17:
      text_layer_set_text(time_label, "pebble>d");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 18:
      text_layer_set_text(time_label, "pebble>da");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 19:
      text_layer_set_text(time_label, "pebble>date");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 20:
      text_layer_set_text(time_label, "pebble>date +");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 21:
      text_layer_set_text(time_label, "pebble>date +%");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 22:
      text_layer_set_text(time_label, "pebble>date +%s");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 23:
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(time_layer));

      if (settings.FeedEnabled) {
        text_layer_set_text(feed_label, "pebble>");
      } else {
        layer_add_child(window_get_root_layer(window), inverter_layer_get_layer(prompt_layer));
        text_layer_set_text(prompt_label, "pebble>");
        prompt_visible = true;
        state = 32;
      }
      timer = app_timer_register(5 * TYPE_DELTA, set_time_anim, 0);
      break;
    case 24:
      text_layer_set_text(feed_label, "pebble>./");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 25:
      text_layer_set_text(feed_label, "pebble>./f");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 26:
      text_layer_set_text(feed_label, "pebble>./fee");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 27:
      text_layer_set_text(feed_label, "pebble>./feed");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 28:
      text_layer_set_text(feed_label, "pebble>./feed.");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 29:
      text_layer_set_text(feed_label, "pebble>./feed.s");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 30:
      text_layer_set_text(feed_label, "pebble>./feed.sh");
      timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
      break;
    case 31:
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(feed_layer));
      layer_set_hidden(text_layer_get_layer(feed_layer), false);

      if (settings.FeedEnabled) {
        marquee_feed_title();
      }

      timer = app_timer_register(5 * TYPE_DELTA, set_time_anim, 0);
      break;
    case 32:
      if (settings.FeedEnabled) {
        marquee_feed_title();
      }

      prompt_visible = false;
      timer = app_timer_register(PROMPT_DELTA, set_time_anim, 0);
      break;
    default:
      if (state > 33) {
        state = 33;
      }

      // Rest of the minute
      if (settings.FeedEnabled) {
        marquee_feed_title();

        if (feed_marquee_animating) {
          if (!feed_marquee_animated) {
            feed_marquee_animated = true;
          } else {
            feed_marquee_animated = false;
            timer = app_timer_register(MARQUEE_DELTA, set_time_anim, 0);
            break;
          }
        }
      } else {
        if (prompt_visible) {
          prompt_visible = false;
          layer_remove_from_parent(inverter_layer_get_layer(prompt_layer));
        } else {
          prompt_visible = true;
          layer_add_child(window_get_root_layer(window), inverter_layer_get_layer(prompt_layer));
        }
      }

      if (firstRun && initTime != 0 && ++initTime > INITTIME_PROMPT_LIMIT) {
        initTime = 0;
        firstRun = false;
      }

      if (settings.FeedEnabled && feed_marquee_animating) {
        timer = app_timer_register(MARQUEE_DELTA, set_time_anim, 0);
      } else {
        timer = app_timer_register(PROMPT_DELTA, set_time_anim, 0);
      }
      break;
  }

  if (state > 0 && !settings.TypingAnimation) {
    update_time();
  }

  state++;
}

// display settings

static void reset_display(void) {
  // Blank before time change
  text_layer_set_text(date_label, "pebble>");
  layer_remove_from_parent(text_layer_get_layer(date_layer));
  text_layer_set_text(hour_label, "");
  layer_remove_from_parent(text_layer_get_layer(hour_layer));
  text_layer_set_text(time_label, "");
  layer_remove_from_parent(text_layer_get_layer(time_layer));
  text_layer_set_text(prompt_label, "");

  layer_remove_from_parent(inverter_layer_get_layer(prompt_layer));

  text_layer_set_text(feed_label, "");
  layer_remove_from_parent(text_layer_get_layer(feed_layer));

  layer_set_hidden(text_layer_get_layer(feed_layer), true);

  prompt_visible = false;

  marquee_feed_title_reset();
}

static void refresh_display_anim(void) {
  // start animation
  state = 0;

  // reset display
  reset_display();
}

static void register_anim_timer(void) {
  if (!timerRegistered) {
    timerRegistered = true;
    timer = app_timer_register(TYPE_DELTA, set_time_anim, 0);
  }
}

static void reset_animation(void) {
  if (timer != NULL) {
    app_timer_cancel(timer);
    timerRegistered = false;
  }

  refresh_display_anim();
  register_anim_timer();
}

// callback for settings
static void term_sync_feed_start(void) {
  if (feed_enabled_reload_locked) {
    feed_title_ready = true;
  } else if (!feed_title_sending) {
    feed_title_ready = false;

    feed_title_sending = true;
    feed_wait_time = FEED_WAIT_TIME_LIMIT_LONG;
    feed_append_len = 0;

    memset(feed_buffer, 0, sizeof(feed_buffer));
    memset(feed_prev_title, 0, sizeof(feed_prev_title));

    strncpy(feed_title, "Loading...       ", 17);
    text_layer_set_text(feed_layer, feed_title);
  }
}

static void term_sync_feed_end(void) {
  if (feed_enabled_reload_locked || !feed_title_sending) {
    return;
  }

  char buf[FEED_TITLE_CHUNK_SIZE];

  feed_title_sending = false;

  while (strlen(feed_buffer) < FEED_TITLE_CHUNK_SIZE) {
    strncat(feed_buffer, " ", 1);
  }

  strncpy(buf, feed_buffer, FEED_TITLE_CHUNK_SIZE);
  strncat(feed_buffer, "             ", 13);

  feed_index = 0;
  feed_lastindex = strlen(feed_buffer);
  feed_append_len = 0;

  strncat(feed_buffer, buf, FEED_TITLE_CHUNK_SIZE);
  strncpy(feed_title, feed_buffer, FEED_TITLE_CHUNK_SIZE);

  text_layer_set_text(feed_layer, feed_title);
  feed_wait_time = FEED_WAIT_TIME_LIMIT;

  feed_title_ready = true;
}

static void sync_message_type(uint8_t msg_type) {
  switch (msg_type) {
    case MSG_TYPE_FEED_FETCHED:
      feed_fetched = true;
      break;
    case MSG_TYPE_FEED_TITLE_START:
      term_sync_feed_start();
      break;
    case MSG_TYPE_FEED_TITLE_END:
      term_sync_feed_end();
      break;
  }
}

static void term_sync_feed_title_append(const Tuple* new_tuple) {
  if (!feed_enabled_reload_locked) {
    if (!feed_title_sending) {
      return;
    }

    if (feed_append_len > 0 && strlen(new_tuple->value->cstring) == 0) {
      feed_append_len = FEED_MAX_TITLE_LEN;
      term_sync_feed_end();
      return;
    }

    if (feed_append_len + FEED_TITLE_CHUNK_SIZE > FEED_MAX_TITLE_LEN) {
      feed_append_len = FEED_MAX_TITLE_LEN;
      term_sync_feed_end();
      return;
    }

    char s[FEED_TITLE_CHUNK_SIZE];

    strncpy(s, new_tuple->value->cstring, FEED_TITLE_CHUNK_SIZE);

    // Skip duplicate title
    if (strcmp(s, feed_prev_title) == 0) {
      return;
    }

    strncpy(feed_prev_title, s, FEED_TITLE_CHUNK_SIZE);
    strncat(feed_buffer, s, FEED_TITLE_CHUNK_SIZE);

    feed_append_len += FEED_TITLE_CHUNK_SIZE;
  }
}

static void term_sync_feed_enabled(uint8_t value) {
  prevFeedEnabled = settings.FeedEnabled;
  settings.FeedEnabled = value;

  // Must reload display if Feed URL changed
  if (!feed_enabled_initialized) {
    if (--feed_enabled_init_count <= 0) {
      feed_enabled_init_count = 0;

      if ((settings.FeedEnabled
           && settings.FeedEnabled != prevFeedEnabled)
          || (!settings.FeedEnabled
              && settings.FeedEnabled == prevFeedEnabled)) {
        feed_enabled_initialized = true;
      }
    }
  } else {
    if (settings.FeedEnabled != prevFeedEnabled) {
      if (settings.FeedEnabled
          && !prevFeedEnabled && !feed_title_sending) {

        strncpy(feed_buffer, "Please reload    ", 17);
        strncpy(feed_title, feed_buffer, 17);

        text_layer_set_text(feed_layer, feed_title);

        feed_enabled_reload_locked = true;
        feed_index = 0;
        feed_title_ready = true;
      }

      reset_next_tick = true;
      reset_animation();
    }
  }
}

static void sync_error_callback(DictionaryResult dict_error,
                                AppMessageResult app_message_error,
                                void *context) {
  //APP_LOG(APP_LOG_LEVEL_DEBUG, "App Message Sync Error: %d", app_message_error);
}

static void sync_tuple_changed_callback(const uint32_t key,
                                        const Tuple* new_tuple,
                                        const Tuple* old_tuple,
                                        void* context) {
  switch (key) {
    case BLUETOOTH_VIBE_KEY:
      settings.BluetoothVibe = new_tuple->value->uint8;
      break;
    case TYPING_ANIMATION_KEY:
      settings.TypingAnimation = new_tuple->value->uint8;
      break;
    case TIMEZONE_OFFSET_KEY:
      settings.TimezoneOffset = new_tuple->value->int16;
      break;
    case FEED_ENABLED_KEY:
      term_sync_feed_enabled(new_tuple->value->uint8);
      break;
    case FEED_URL_KEY:
      // nothing
      break;
    case MSG_TYPE_KEY:
      // message from JavaScript
      sync_message_type(new_tuple->value->uint8);
      break;
    case FEED_TITLE_KEY:
      term_sync_feed_title_append(new_tuple);
      break;
  }
}

static void in_dropped_handler(AppMessageResult reason, void *context) {
}

static void out_failed_handler(DictionaryIterator *failed, AppMessageResult reason, void *context) {
}

static void in_received_handler(DictionaryIterator *iter, void *context) {
}


static bool send_msg(Tuplet t) {

  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return false;
  }

  if (iter == NULL) {
    return false;
  }

  dict_write_tuplet(iter, &t);
  dict_write_end(iter);

  return (app_message_outbox_send() == APP_MSG_OK);
}

static void ping(void) {
  Tuplet type_tuplet = TupletInteger(MSG_TYPE_KEY, 0);

  send_msg(type_tuplet);
}

static void send_close_msg(void) {
  Tuplet type_tuplet = TupletInteger(MSG_TYPE_KEY, 1);

  send_msg(type_tuplet);
}

static void fetch_feed(void) {
  if (!can_fetch_feed) {
    return;
  }
  can_fetch_feed = false;

  Tuplet type_tuplet = TupletInteger(MSG_TYPE_KEY, 2);

  send_msg(type_tuplet);
}

static void ready_feed(void) {
  Tuplet type_tuplet = TupletInteger(MSG_TYPE_KEY, 3);

  send_msg(type_tuplet);
}


static void tick_handler(struct tm *t, TimeUnits units_changed) {
  bool reset = false;

  switch (initTime) {
    case 0: // initialized
      if (settings.TypingAnimation) {
        reset = true;
      }
      break;
    case 1: // init
      if (firstRun && !timerRegistered) {
        reset = true;
      }
      break;
  }

  if (reset_next_tick && !firstRun) {
    reset = true;
  }

  if (!reset) {
    register_anim_timer();
    return;
  }

  if (reset_next_tick) {
    reset_next_tick = false;
  }

  reset_animation();

  if (firstRun && initTime == 1 && settings.FeedEnabled) {
    can_fetch_feed = true;
    // send ready message to JavaScript
    ready_feed();
  }
}

// window lifecycle

static void window_load(Window *window) {
  // font
  ResHandle font_handle = resource_get_handle(RESOURCE_ID_FONT_LUCIDA_13);

  // date
  date_label = cl_init_text_layer(GRect(5, 24, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(date_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(date_label));

  date_layer = cl_init_text_layer(GRect(5, 40, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(date_layer, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(date_layer));

  // hour
  hour_label = cl_init_text_layer(GRect(5, 55, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(hour_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(hour_label));

  hour_layer = cl_init_text_layer(GRect(5, 71, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(hour_layer, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(hour_layer));

  // time
  time_label = cl_init_text_layer(GRect(5, 87, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(time_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(time_label));

  time_layer = cl_init_text_layer(GRect(5, 103, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(time_layer, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(time_layer));

  // prompt
  prompt_label = cl_init_text_layer(GRect(5, 119, 144, 30),
                                    GColorWhite,
                                    GColorClear,
                                    font_handle,
                                    GTextAlignmentLeft);
  text_layer_set_text(prompt_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(prompt_label));

  prompt_layer = inverter_layer_create(GRect(61, 132, 8, 2));

  // feed
  feed_label = cl_init_text_layer(GRect(5, 119, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);
  text_layer_set_text(feed_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(feed_label));

  feed_layer = cl_init_text_layer(GRect(5, 135, 144, 30),
                                  GColorWhite,
                                  GColorClear,
                                  font_handle,
                                  GTextAlignmentLeft);

  text_layer_set_text(feed_layer, "");
  layer_set_hidden(text_layer_get_layer(feed_layer), true);
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(feed_layer));
}


static void window_unload(Window *window) {
  // send message to close
  send_close_msg();

  // date
  text_layer_destroy(date_label);
  text_layer_destroy(date_layer);

  // time
  text_layer_destroy(time_label);
  text_layer_destroy(time_layer);

  // hour
  text_layer_destroy(hour_label);
  text_layer_destroy(hour_layer);

  // Prompt
  text_layer_destroy(prompt_label);
  inverter_layer_destroy(prompt_layer);

  // feed
  text_layer_destroy(feed_label);
  text_layer_destroy(feed_layer);

  if (timer != NULL) {
    app_timer_cancel(timer);
    timerRegistered = false;
  }
}

// app lifecycle

static void init(void) {
  memset(&battery_percent_layers, 0, sizeof(battery_percent_layers));
  memset(&battery_percent_image, 0, sizeof(battery_percent_image));

  window = window_create();
  if (window == NULL) {
    return;
  }
  window_layer = window_get_root_layer(window);

  const int inbound_size = 128;
  const int outbound_size = 128;
  app_message_open(inbound_size, outbound_size);

  persist_read_data(SETTINGS_KEY, &settings, sizeof(settings));

  background_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BACKGROUND);
  background_layer = bitmap_layer_create(layer_get_frame(window_layer));

  bitmap_layer_set_bitmap(background_layer, background_image);
  layer_add_child(window_layer, bitmap_layer_get_layer(background_layer));

  WindowHandlers handlers = {
    .load = window_load,
    .unload = window_unload
  };

  window_set_window_handlers(window, handlers);
  window_set_background_color(window, GColorBlack);

  // Get tick events
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);

  // bluetooth
  bluetooth_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BLUETOOTH);
  GRect frame3 = (GRect) {
    .origin = { .x = 80, .y = 5 },
    .size = bluetooth_image->bounds.size
  };
  bluetooth_layer = bitmap_layer_create(frame3);
  bitmap_layer_set_bitmap(bluetooth_layer, bluetooth_image);

  // battery
  battery_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BATTERY);
  GRect frame4 = (GRect) {
    .origin = { .x = 121, .y = 6 },
    .size = battery_image->bounds.size
  };
  battery_layer = bitmap_layer_create(frame4);
  battery_image_layer = bitmap_layer_create(frame4);
  bitmap_layer_set_bitmap(battery_image_layer, battery_image);
  layer_set_update_proc(bitmap_layer_get_layer(battery_layer), battery_layer_update_callback);

  // mask the pebble branding
  GRect framemask = (GRect) {
    .origin = { .x = 0, .y = 0 },
    .size = { .w = 144, .h = 19 }
  };
  branding_mask_layer = bitmap_layer_create(framemask);
  layer_add_child(window_layer, bitmap_layer_get_layer(branding_mask_layer));
  branding_mask_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BRANDING_MASK);
  bitmap_layer_set_bitmap(branding_mask_layer, branding_mask_image);

  //XXX: mask
  layer_set_hidden(bitmap_layer_get_layer(branding_mask_layer), true);

  layer_add_child(window_layer, bitmap_layer_get_layer(bluetooth_layer));
  layer_add_child(window_layer, bitmap_layer_get_layer(battery_image_layer));
  layer_add_child(window_layer, bitmap_layer_get_layer(battery_layer));

  // Create time and date layers
  GRect dummy_frame = { {0, 0}, {0, 0} };

  for (int i = 0; i < TOTAL_BATTERY_PERCENT_DIGITS; ++i) {
    battery_percent_layers[i] = bitmap_layer_create(dummy_frame);
    layer_add_child(window_layer, bitmap_layer_get_layer(battery_percent_layers[i]));
  }

  toggle_bluetooth_icon(bluetooth_connection_service_peek());
  update_battery(battery_state_service_peek());

  Tuplet initial_values[] = {
    TupletInteger(BLUETOOTH_VIBE_KEY, settings.BluetoothVibe),
    TupletInteger(TYPING_ANIMATION_KEY, settings.TypingAnimation),
    TupletInteger(TIMEZONE_OFFSET_KEY, settings.TimezoneOffset),
    TupletInteger(FEED_ENABLED_KEY, settings.FeedEnabled),
    TupletCString(FEED_URL_KEY, ""),
    TupletInteger(MSG_TYPE_KEY, (uint8_t)0),
    TupletCString(FEED_TITLE_KEY, "Loading..........")
  };

  app_sync_init(&sync, sync_buffer, sizeof(sync_buffer),
                initial_values, ARRAY_LENGTH(initial_values),
                sync_tuple_changed_callback,
                sync_error_callback,
                NULL);

  appStarted = true;

  bluetooth_connection_service_subscribe(bluetooth_connection_callback);
  battery_state_service_subscribe(&update_battery);

  const bool animated = true;
  window_stack_push(window, animated);
}

static void deinit(void) {
  app_sync_deinit(&sync);

  bluetooth_connection_service_unsubscribe();
  battery_state_service_unsubscribe();
  tick_timer_service_unsubscribe();

  layer_remove_from_parent(bitmap_layer_get_layer(background_layer));
  bitmap_layer_destroy(background_layer);
  gbitmap_destroy(background_image);
  background_image = NULL;

  layer_remove_from_parent(bitmap_layer_get_layer(bluetooth_layer));
  bitmap_layer_destroy(bluetooth_layer);
  gbitmap_destroy(bluetooth_image);
  bluetooth_image = NULL;

  layer_remove_from_parent(bitmap_layer_get_layer(battery_layer));
  bitmap_layer_destroy(battery_layer);
  gbitmap_destroy(battery_image);
  battery_image = NULL;

  background_image = NULL;

  layer_remove_from_parent(bitmap_layer_get_layer(battery_image_layer));
  bitmap_layer_destroy(battery_image_layer);

  for (int i = 0; i < TOTAL_BATTERY_PERCENT_DIGITS; i++) {
    layer_remove_from_parent(bitmap_layer_get_layer(battery_percent_layers[i]));
    gbitmap_destroy(battery_percent_image[i]);
    battery_percent_image[i] = NULL;
    bitmap_layer_destroy(battery_percent_layers[i]);
    battery_percent_layers[i] = NULL;
  }

  layer_remove_from_parent(window_layer);
  layer_destroy(window_layer);

  window_destroy(window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}

// Other functions

static TextLayer* cl_init_text_layer(GRect location,
                                     GColor colour,
                                     GColor background,
                                     ResHandle handle,
                                     GTextAlignment alignment) {

  TextLayer *layer = text_layer_create(location);
  text_layer_set_text_color(layer, colour);
  text_layer_set_background_color(layer, background);
  text_layer_set_font(layer, fonts_load_custom_font(handle));
  text_layer_set_text_alignment(layer, alignment);

  return layer;
}

