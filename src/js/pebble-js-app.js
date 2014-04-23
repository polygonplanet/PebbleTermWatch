// Pebble Term Watch

var SETTINGS_URL = 'http://polygonplanet.github.io/PebbleTermWatch/settings/index.html';

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
      return (v - 0) ? 1 : 0;
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
      return (v - 0) ? 1 : 0;
    }
  },
  timezoneOffset: {
    value: new Date().getTimezoneOffset() * 60,
    get: function() {
      return this.value;
    },
    set: function() {
      return this.value;
    },
    fix: function() {
      return this.value;
    }
  }
};

var getData = function() {
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

    if (item !== null && item !== void 0) {
      field.set(item);
    }
  });
};

Pebble.addEventListener('ready', function(e) {
  loadLocalData();
  Pebble.sendAppMessage(getData());
});

Pebble.addEventListener('showConfiguration', function(e) {
  Pebble.openURL(SETTINGS_URL);
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (e.response) {
    loadLocalData();
    saveLocalData(JSON.parse(e.response));
    Pebble.sendAppMessage(getData());
  }
});
