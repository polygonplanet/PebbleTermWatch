/*
 * Pebble Term Watch
 *
 * pebble watchface for sdk 2
 *
 * Watchface based and special thanks to:
 *  CMD Time Typed: https://github.com/C-D-Lewis/cmd-time-typed
 *  91 Dub v2.0: https://github.com/orviwan/91-Dub-v2.0
 */
#include <pebble.h>

#define TYPE_DELTA 200
#define PROMPT_DELTA 1000

// Layers
static Window *window;
static Layer *window_layer;

static TextLayer *time_label, *time_layer,
                 *date_label, *date_layer,
                 *hour_label, *hour_layer,
                 *prompt_label;

static InverterLayer *prompt_layer;

static AppTimer *timer;

#define SETTINGS_KEY 99

typedef struct persist {
	int Blink;
  int Invert;
  int BluetoothVibe;
  int HourlyVibe;
  int BrandingMask;
  int TimezoneOffset;
} __attribute__((__packed__)) persist;

persist settings = {
  .Blink = 1,
  .Invert = 0,
  .BluetoothVibe = 1,
  .HourlyVibe = 0,
  .BrandingMask = 1,
  .TimezoneOffset = 32400 // 32400 = ja GMT+0900 = 9*60*60
};

enum {
  BLINK_KEY = 0x0,
  INVERT_KEY = 0x1,
  BLUETOOTHVIBE_KEY = 0x2,
  HOURLYVIBE_KEY = 0x3,
  BRANDING_MASK_KEY = 0x4,
  TIMEZONEOFFSET_KEY = 0x5
};

static bool appStarted = false;

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

#define TOTAL_BATTERY_PERCENT_DIGITS 3
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

// Buffers
static char date_buffer[] = "XXXX-XX-XX",
            hour_buffer[] = "XX:XX:XX",
            //day_buffer[] = "XXX",
            time_buffer[] = "XXXXXXXXXXXXXXX";
            //time_buffer[] = "2147483647";

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

  if (settings.Invert) {
    background_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BACKGROUND_INVERT);
    branding_mask_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BRANDING_MASK_INVERT);
  } else {
    background_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BACKGROUND);
    branding_mask_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BRANDING_MASK);
  }
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
      layer_set_hidden(bitmap_layer_get_layer(battery_percent_layers[i]), true);
    }
    return;
  }

  layer_set_hidden(bitmap_layer_get_layer(battery_layer), charge_state.is_charging);
  change_battery_icon(charge_state.is_charging);

  for (int i = 0; i < TOTAL_BATTERY_PERCENT_DIGITS; ++i) {
    layer_set_hidden(bitmap_layer_get_layer(battery_percent_layers[i]), false);
  }

  set_container_image(&battery_percent_image[0],
                      battery_percent_layers[0],
                      TINY_IMAGE_RESOURCE_IDS[charge_state.charge_percent / 10],
                      GPoint(99, 5));

  set_container_image(&battery_percent_image[1],
                      battery_percent_layers[1],
                      TINY_IMAGE_RESOURCE_IDS[charge_state.charge_percent % 10],
                      GPoint(105, 5));

  set_container_image(&battery_percent_image[2],
                      battery_percent_layers[2],
                      TINY_IMAGE_RESOURCE_IDS[10],
                      GPoint(111, 6));
}

void battery_layer_update_callback(Layer *me, GContext* ctx) {
  // draw the remaining battery percentage
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, GRect(2, 2, ((batteryPercent / 100.0) * 11.0), 5), 0, GCornerNone);
}

// bluetooth
static void toggle_bluetooth_icon(bool connected) {
  if (appStarted && !connected && settings.BluetoothVibe) {
    // vibe!
    vibes_long_pulse();
  }
  layer_set_hidden(bitmap_layer_get_layer(bluetooth_layer), !connected);
}

void bluetooth_connection_callback(bool connected) {
  toggle_bluetooth_icon(connected);
}


// Time Lifecycle

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

  // unix time
  // Pebble SDK 2 can't get timezone offset?
  snprintf(time_buffer, sizeof("XXXXXXXXXXXXXXX"), "%u", (unsigned)time(NULL) - settings.TimezoneOffset);
  text_layer_set_text(time_layer, time_buffer);
}

static void set_time_anim() {
  // Time structures -- Cannot be branch declared
  time_t temp;
  struct tm *t;

  // frame animation
  switch (state) {
    case 0:
      temp = time(NULL);
      t = localtime(&temp);
      set_time(t);
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
      text_layer_set_text(date_label, "pebble>date +%F");
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(date_layer));
      text_layer_set_text(hour_label, "pebble>");
      timer = app_timer_register(10 * TYPE_DELTA, set_time_anim, 0);
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
      text_layer_set_text(hour_label, "pebble>date +%T");
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(hour_layer));
      text_layer_set_text(time_label, "pebble>");
      timer = app_timer_register(10 * TYPE_DELTA, set_time_anim, 0);
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
      text_layer_set_text(time_label, "pebble>date +%s");
      layer_add_child(window_get_root_layer(window), text_layer_get_layer(time_layer));
      text_layer_set_text(prompt_label, "pebble>");
      prompt_visible = true;
      timer = app_timer_register(PROMPT_DELTA, set_time_anim, 0);
      break;
    default:
      // Rest of the minute
      if (prompt_visible) {
        prompt_visible = false;
        layer_remove_from_parent(inverter_layer_get_layer(prompt_layer));
      } else {
        prompt_visible = true;
        layer_add_child(window_get_root_layer(window), inverter_layer_get_layer(prompt_layer));
      }
      timer = app_timer_register(PROMPT_DELTA, set_time_anim, 0);
      break;
  }
  state++;
}

static void tick_handler(struct tm *t, TimeUnits units_changed) {
  if (timer != NULL) {
    app_timer_cancel(timer);
  }

  // Start anim cycle
  state = 0;
  timer = app_timer_register(PROMPT_DELTA, set_time_anim, 0);

  // Blank before time change
  text_layer_set_text(date_label, "pebble>");
  layer_remove_from_parent(text_layer_get_layer(date_layer));
  text_layer_set_text(hour_label, "");
  layer_remove_from_parent(text_layer_get_layer(hour_layer));
  text_layer_set_text(time_label, "");
  layer_remove_from_parent(text_layer_get_layer(time_layer));
  text_layer_set_text(prompt_label, "");

  layer_remove_from_parent(inverter_layer_get_layer(prompt_layer));
  prompt_visible = false;

  // Change time display
  set_time(t);
}

// Window Lifecycle

static void window_load(Window *window) {
  // Font
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

  // Time
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

  // Prompt
  prompt_label = cl_init_text_layer(GRect(5, 119, 144, 30),
                                    GColorWhite,
                                    GColorClear,
                                    font_handle,
                                    GTextAlignmentLeft);
  text_layer_set_text(prompt_label, "");
  layer_add_child(window_get_root_layer(window), text_layer_get_layer(prompt_label));

  prompt_layer = inverter_layer_create(GRect(61, 132, 8, 2));
}

static void window_unload(Window *window) {
  // date
  text_layer_destroy(date_label);
  text_layer_destroy(date_layer);

  // time
  text_layer_destroy(time_label);
  text_layer_destroy(time_layer);

  // Prompt
  text_layer_destroy(prompt_label);
  inverter_layer_destroy(prompt_layer);
}

// App Lifecycle

static void init(void) {
  memset(&battery_percent_layers, 0, sizeof(battery_percent_layers));
  memset(&battery_percent_image, 0, sizeof(battery_percent_image));

  window = window_create();
  if (window == NULL) {
    //APP_LOG(APP_LOG_LEVEL_DEBUG, "OOM: couldn't allocate window");
    return;
  }
  window_layer = window_get_root_layer(window);

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
    .origin = { .x = 86, .y = 5 },
    .size = bluetooth_image->bounds.size
  };
  bluetooth_layer = bitmap_layer_create(frame3);
  bitmap_layer_set_bitmap(bluetooth_layer, bluetooth_image);

  // battery
  battery_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BATTERY);
  GRect frame4 = (GRect) {
    .origin = { .x = 121, .y = 5 },
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
  branding_mask_image = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BRANDING_MASK/*_INVERT*/);
  bitmap_layer_set_bitmap(branding_mask_layer, branding_mask_image);
  layer_set_hidden(bitmap_layer_get_layer(branding_mask_layer), !settings.BrandingMask);

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

  appStarted = true;

  bluetooth_connection_service_subscribe(bluetooth_connection_callback);
  battery_state_service_subscribe(&update_battery);

  window_stack_push(window, true);
}

static void deinit(void) {
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
