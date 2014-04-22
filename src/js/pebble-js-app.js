// Pebble Term Watch

var SETTINGS_URL = 'http://polygonplanet.github.io/PebbleTermWatch/settings/';

var sendTimezoneToWatch = function() {
  // Get the number of seconds to add to convert localtime to utc
  var offsetSeconds = new Date().getTimezoneOffset() * 60;

  console.log('offsetSeconds=' + offsetSeconds);
  localStorage.setItem('timezoneOffset', offsetSeconds);

  // Send it to the watch
  Pebble.sendAppMessage({ timezoneOffset: offsetSeconds });
};

var store = {
  bluetoothVibe: {
    value: true,
    set: function(v) {
      this.value = !!v;
    },
    get: function() {
      return this.value ? 1 : 0;
    }
  },
  typingAnimation: {
    value: true,
    set: function(v) {
      this.value = !!v;
    },
    get: function() {
      return this.value ? 1 : 0;
    }
  },
  timezoneOffset: (function() {
    // timezone offset limit (-1440 * 60 to 1440 * 60)
    var fix = function(v) {
      return Math.max(-1440 * 60, Math.min(1440 * 60, v - 0)) || 0;
    };

    return {
      value: new Date().getTimezoneOffset() * 60,
      set: function(v) {
        this.value = fix(v);
      },
      get: function() {
        return fix(this.value);
      }
    };
  }())
};


var saveLocalData = function(data) {
  return Object.keys(store).reduce(function(o, k) {
    var field = store[k];

    field.value = field.set(data[k]);
    o[k] = store.get();
    localStorage.setItem(k, o[k]);
    return o;
  }, {});
};


var loadLocalData = function() {
  Object.keys(store).forEach(function(key) {
    var item = localStorage.getItem(key);
    var field = store[key];

    // CodeMirror warns (item != null)
    if (item !== null && item !== void 0) {
      field.value = item;
    }

    field.set(field.value);
  });
};


Pebble.addEventListener('ready', function(e) {
  loadLocalData();
  sendTimezoneToWatch();
});

Pebble.addEventListener('showConfiguration', function(e) {
  Pebble.openURL(SETTINGS_URL);
});

Pebble.addEventListener('webviewclosed', function(e) {
  var data;

  if (e.response) {
    data = JSON.parse(e.response);
    Pebble.sendAppMessage(saveLocalData(data));
  }
});
