// Pebble Term Watch

var SETTINGS_URL = 'http://polygonplanet.github.io/PebbleTermWatch/settings/';

var store = {
  bluetoothVibe: {
    value: 1,
    get: function() {
      return this.fix(this.value);
    },
    set: function(v) {
      return (this.value = this.fix(v));
    },
    fix: function(v) {
      return v ? 1 : 0;
    }
  },
  typingAnimation: {
    value: 1,
    get: function() {
      return this.fix(this.value);
    },
    set: function(v) {
      return (this.value = this.fix(v));
    },
    fix: function(v) {
      return v ? 1 : 0;
    }
  },
  timezoneOffset: {
    value: new Date().getTimezoneOffset() * 60,
    get: function() {
      return this.fix(this.value);
    },
    set: function(v) {
      return (this.value = this.fix(v));
    },
    // timezone offset limit (-1440 * 60 to 1440 * 60)
    fix: function(v) {
      return Math.max(-1440 * 60, Math.min(1440 * 60, v - 0)) || 0;
    }
  }
};

var getMessage = function() {
  return Object.keys(store).reduce(function(o, k) {
    return o[k] = store[k].get(), o;
  }, {});
};

var saveLocalData = function(data) {
  Object.keys(store).forEach(function(key) {
    localStorage.setItem(key, store[key].set(data[key]));
  });
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
  Pebble.sendAppMessage(getMessage());
});

Pebble.addEventListener('showConfiguration', function(e) {
  Pebble.openURL(SETTINGS_URL);
});

Pebble.addEventListener('webviewclosed', function(e) {
  var data;

  if (e.response) {
    data = JSON.parse(e.response);
    saveLocalData(data);
    Pebble.sendAppMessage(getMessage());
  }
});
