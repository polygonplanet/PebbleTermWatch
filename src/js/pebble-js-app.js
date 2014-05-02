/*
 * Pebble Term Watch
 *
 * Pebble JavaScript Framework SDK 2
 * https://github.com/polygonplanet/PebbleTermWatch
 */

var SETTINGS_URL = 'http://polygonplanet.github.io/PebbleTermWatch/settings/1.0.4.html';

var MSG_TYPE_PING = 0;
var MSG_TYPE_APP_CLOSE = 1;
var MSG_TYPE_FETCH_FEED = 2;
var MSG_TYPE_FEED_READY = 3;
var MSG_TYPE_FEED_FETCHED = 4;
var MSG_TYPE_FEED_TITLE_START = 5;
var MSG_TYPE_FEED_TITLE_END = 6;

(function(global, exports, require) {
'use strict';

var Store = require('store');
var Feed = require('feed');
var util = require('util');
var PebbleTerm = require('pebbleterm');

var store, feed;

util.mixin(PebbleTerm, {
  ready: false,
  closed: false,
  cleared: false
});

var sendMsg = PebbleTerm.sendMsg = function(msg/*[, ackHandler, nackHandler]*/) {
  // sendAppMessage is undefined on before load
  if (typeof Pebble.sendAppMessage === 'undefined') {
    return;
  }

  var args = Array.prototype.slice.call(arguments, 1);
  var context = this;
  var isLocked = (sendMsg.locked &&
                 (!context || context.locked !== sendMsg.locked));

  if (isLocked) {
    if (!msg && sendMsg.queue.length > 1) {
      // Drop a ping message
      return;
    }
    sendMsg.queue.push(msg);
  } else {
    var defaults = { msgType: MSG_TYPE_PING };
    msg = msg || defaults;

    if (store) {
      if (msg !== defaults) {
        store.update(msg);
      }
      msg = store.toObject('send');
    }
    Pebble.sendAppMessage.apply(Pebble, [msg].concat(args));
  }

  if (sendMsg.queue.length) {
    var item = sendMsg.queue.shift();

    setTimeout(function() {
      sendMsg.apply(context, [item].concat(args));
    }, 1000 + ~~(Math.random() * 500));
  }
};

sendMsg.queue = [];

sendMsg.lock = (function() {
  var ids = {};
  var genid = function() {
    var id = Math.random().toString(36).slice(1);
    return (id in ids) ? genid() : (ids[id] = null, id);
  };

  return function() {
    if (sendMsg.locked) {
      return false;
    }
    return (sendMsg.locked = genid());
  };
}());

sendMsg.unlock = function(id) {
  if (!sendMsg.locked) {
    return true;
  }

  if (sendMsg.locked === id) {
    delete sendMsg.locked;
    return true;
  }
  return false;
};


Pebble.addEventListener('ready', function(ev) {
  store.load();

  // lifecycle
  sendMsg();
  PebbleTerm.ready = true;
});

Pebble.addEventListener('showConfiguration', function(ev) {
  var url = store.toURI(SETTINGS_URL);

  Pebble.openURL(url);
});

Pebble.addEventListener('webviewclosed', function(ev) {
  if (ev.response) {
    if (!PebbleTerm.cleared) {
      store.clear();
      PebbleTerm.cleared = true;
    }

    store.fromURI(ev.response);
    store.save();
    sendMsg();
  }
});

Pebble.addEventListener('appmessage', function(e) {
  if (e.payload) {
    switch (e.payload.msgType) {
      case MSG_TYPE_PING:
        break;
      case MSG_TYPE_APP_CLOSE:
        PebbleTerm.closed = true;

        if (feed) {
          feed.stop = true;
        }
        return;
      case MSG_TYPE_FETCH_FEED:
        if (feed && feed.url) {
          feed.refetch = true;
        }
        break;
      case MSG_TYPE_FEED_READY:
        if (feed && feed.url && !feed.fetching) {
          feed.fetch();
        }
        break;
      case MSG_TYPE_FEED_FETCHED:
        break;
    }
  }

  // ping
  sendMsg();
});

store = PebbleTerm.store = new Store({
  bluetoothVibe: {
    send: true,
    storage: true,
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
    send: true,
    storage: true,
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
    send: true,
    storage: true,
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
  },
  msgType: {
    send: true,
    storage: false,
    value: 0,
    get: function() {
      return this.fix(this.value);
    },
    set: function(v) {
      return (this.value = this.fix(v));
    },
    fix: function(v) {
      return ~~(v - 0) || 0;
    }
  },
  feedUrl: {
    send: false,
    storage: true,
    value: '',
    get: function() {
      return this.fix(this.value);
    },
    set: function(v) {
      this.value = this.fix(v);
      return this.value;
    },
    fix: function(v) {
      var url = ('' + v).replace(/^\s+|\s+$/g, '');
      return /^https?:\/\//.test(url) ? url : '';
    }
  },
  feedEnabled: {
    send: true,
    storage: false,
    _value: 0,
    get value() {
      this.update();
      return this.fix(this._value);
    },
    set value(v) {
      return (this._value = this.fix(v));
    },
    get: function() {
      return this.value;
    },
    set: function(v) {
      return (this.value = v);
    },
    fix: function(v) {
      return (v - 0) ? 1 : 0;
    },
    update: function() {
      var url = store.feedUrl.get();
      this.set(url ? 1 : 0);
    }
  },
  feedTitle: {
    send: true,
    storage: false,
    value: '',
    get: function() {
      return this.value;
    },
    set: function(v) {
      return (this.value = this.fix(v));
    },
    fix: function(v) {
      v = '' + (v === void 0 ? this.value : v);
      return v.substr(0, Feed.TITLE_CHUNK_MAX_LEN);
    }
  }
});


util.till(function() {
  return PebbleTerm.ready;
}).then(function() {
  var url = store.feedUrl.get();

  if (url) {
    feed = PebbleTerm.feed = new Feed(url);
    feed.fetch();
  }
});


}).apply(this, (function(global, exports, require) {


var Promise = require('promise');

var PebbleTerm = exports.PebbleTerm = {};

var Op = Object.prototype;
var hasOwn = Op.hasOwnProperty.call.bind(Op.hasOwnProperty);

// persist store
var Store = exports.Store = function(props) {
  mixin(this, props);
};

Store.KEY = 'pebbleTerm';

Store.prototype = {
  keys: function(type) {
    var self = this;

    type = type || 'send';

    return Object.keys(this).reduce(function(keys, k) {
      if (self[k][type]) {
        keys.push(k);
      }
      return keys;
    }, []);
  },
  values: function(type) {
    var self = this;

    return this.keys(type).reduce(function(values, k) {
      return values.push(self[k].get()), values;
    }, []);
  },
  toObject: function(type) {
    var values = this.values(type);

    return this.keys(type).reduce(function(o, k, i) {
      return (o[k] = values[i], o);
    }, {});
  },
  toJSON: function(type) {
    return JSON.stringify(this.toObject(type));
  },
  toURI: function(url) {
    var data = this.toObject('storage');

    return Object.keys(data).reduce(function(uri, key) {
      return (uri += encodeURIComponent(key) + '=' +
                     encodeURIComponent(data[key]) + '&');
    }, url + '?').slice(0, -1);
  },
  fromURI: function(uri) {
    var self = this;
    var keys = this.keys('storage');
    var data = JSON.parse(decodeURIComponent(uri));

    if (data && typeof data === 'object') {
      Object.keys(data).forEach(function(key) {
        if (~keys.indexOf(key)) {
          self[key].set(data[key]);
        }
      });
    }
  },
  update: function(data) {
    if (data) {
      Object.keys(this).forEach(function(key) {
        if (hasOwn(data, key)) {
          this[key].set(data[key]);
        }
      }, this);
    }
  },
  save: function() {
    window.localStorage.setItem(Store.KEY, this.toJSON('storage'));
  },
  load: function() {
    var data = window.localStorage.getItem(Store.KEY);

    if (!data) {
      return;
    }

    data = JSON.parse(data);

    if (!data) {
      return;
    }

    Object.keys(data).forEach(function(key) {
      if (hasOwn(this, key)) {
        this[key].set(data[key]);
      }
    }, this);
  },
  clear: function() {
    var key;

    for (var i = 0, len = window.localStorage.length; i < len; i++) {
      key = window.localStorage.key(i);

      if (key !== null && key !== void 0 && key !== Store.KEY) {
        window.localStorage.removeItem(key);
      }
    }
  }
};

// Feed Reader (1 title)
var Feed = exports.Feed = function(url) {
  this.init(url);
};

// fetch interval (seconds)
Feed.FETCH_INTERVAL = 5 * 60;
Feed.TITLE_MAX_LEN = 128;
Feed.TITLE_CHUNK_MAX_LEN = 17;

Feed.prototype = {
  init: function(url) {
    this.url = url;
    this.fetching = false;
    this.title = '';
    this.startTime = null;
    this.locked = null;
    this.stop = false;
  },
  parse: function(res) {
    var doc = new DOMParser().parseFromString(res, 'text/xml');
    var items = doc.getElementsByTagName('item');

    if (items.length === 0) {
      return 'No item';
    }

    var title = items[0].getElementsByTagName('title');

    if (title.length === 0) {
      return 'Item has no title';
    }

    return title[0].textContent;
  },
  truncate: function(title, index) {
    title = '' + (title || '');
    return title.substr(index || 0, Feed.TITLE_CHUNK_MAX_LEN);
  },
  format: function(title) {
    title = toAscii('' + (title || ''));

    var cut = function(s) {
      s = s.replace(/[\u0100-\uffff]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '');

      return s;
    };

    var max = Feed.TITLE_MAX_LEN - 1;
    var len = title.length;

    if (len < max) {
      return title;
    }

    var ellipsis = '...';

    max -= 3;
    while (title.length > max) {
      title = cut(cut(title).slice(0, -1));
    }

    return title + ellipsis;
  },
  sendTitle: function(title) {
    this.updateTitle(title);

    PebbleTerm.sendMsg.call(this,
      PebbleTerm.store.toObject('send'));
  },
  updateTitle: function(title) {
    title = title === void 0 ? this.title : title;

    PebbleTerm.store.update({
      feedTitle: this.truncate(title)
    });
  },
  lockMsg: function() {
    var self = this;

    return new Promise(function(resolve) {
      till(function() {

        return !!(self.locked = PebbleTerm.sendMsg.lock());
      }).then(function() {
        resolve();
      });
    });
  },
  unlockMsg: function() {
    var self = this;

    return new Promise(function(resolve) {
      till(function() {
        if (!PebbleTerm.sendMsg.locked || !self.locked) {
          return true;
        }

        return PebbleTerm.sendMsg.unlock(self.locked);
      }).then(function() {
        self.locked = null;

        resolve();
      });
    });
  },
  sendChunkedTitle: function(title) {
    var self = this;
    var index = 0;

    title = this.format(title);

    this.lockMsg().then(function() {
      self.updateTitle('');

      PebbleTerm.sendMsg.call(self, {
        msgType: MSG_TYPE_FEED_TITLE_START,
        feedTitle: ''
      });
      PebbleTerm.store.update({ msgType: MSG_TYPE_PING });

      delay(1000).then(function() {
        till(function() {
          var data = self.truncate(title, index);

          if (!data) {
            return true;
          }

          index += data.length;
          self.sendTitle(data);

          return false;
        }, 1000).then(function() {
          self.updateTitle('');

          PebbleTerm.sendMsg.call(self, {
            msgType: MSG_TYPE_FEED_TITLE_END,
            feedTitle: ''
          });

          delay(1000).then(function() {
            self.unlockMsg().then(function() {

              PebbleTerm.store.update({
                msgType: MSG_TYPE_PING,
                feedTitle: ''
              });

              self.fetching = false;

              if (!self.stop) {
                self.refetch();
              }
            });
          });
        });
      });
    });
  },
  fetch: function() {
    var self = this;

    this.startTime = Date.now();
    if (PebbleTerm.closed || this.fetching) {
      return new Promise(function() {
        throw 'Cannot fetch feed';
      });
    }

    this.fetching = true;
    this.title = 'Loading...';
    this.sendTitle();

    return request(this.url).then(function(res) {
      var title = self.parse(res);

      self.stop = false;
      self.sendChunkedTitle(title);
    }, function(err) {
      self.stop = true;
      self.sendChunkedTitle('Error:' + err);
    });
  },
  refetch: function() {
    var self = this;

    return till(function() {
      if (self.stop) {
        return true;
      }

      if (Date.now() - self.startTime > Feed.FETCH_INTERVAL * 1000) {
        return true;
      }

      // ping
      PebbleTerm.sendMsg();
      return false;
    }, 2500).then(function() {
      if (self.stop) {
        return;
      }

      self.fetching = false;
      self.fetch();
    });
  }
};

// utilities
exports.util = {};

var mixin = exports.util.mixin = function(target) {
  Array.prototype.slice.call(arguments, 1).forEach(function(source) {
    var key, keys = Object.keys(source);

    for (var i = 0, len = keys.length; i < len; i++) {
      key = keys[i];
      target[key] = source[key];
    }
  });
  return target;
};


var request = exports.util.request = function(url) {
  return new Promise(function(resolve, reject) {
    var req = new XMLHttpRequest();

    req.open('GET', url, true);
    req.onload = function(res) {
      if (req.status === 200) {
        resolve(req.responseText);
      } else {
        reject(req.statusText);
      }
    };

    req.onerror = function() {
      reject(req.statusText);
    };

    req.send();
  });
};


var delay = exports.util.delay = function(time) {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve();
    }, time);
  });
};


var till = exports.util.till = function(cond, interval) {
  interval = interval || 13;

  return new Promise(function till_next(resolve) {
    var args = arguments;
    var time = Date.now();

    if (cond()) {
      resolve();
    } else {
      delay(Math.min(1000, Date.now() - time + interval)).then(function() {
        till_next.apply(null, args);
      });
    }
  });
};


var toAscii = exports.util.toAscii = (function() {

  // via http://stackoverflow.com/questions/990904/javascript-remove-accents-in-strings
  var defaultDiacriticsRemovalap = [
    {'base':'A', 'letters':'\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F'},
    {'base':'AA','letters':'\uA732'},
    {'base':'AE','letters':'\u00C6\u01FC\u01E2'},
    {'base':'AO','letters':'\uA734'},
    {'base':'AU','letters':'\uA736'},
    {'base':'AV','letters':'\uA738\uA73A'},
    {'base':'AY','letters':'\uA73C'},
    {'base':'B', 'letters':'\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0182\u0181'},
    {'base':'C', 'letters':'\u0043\u24B8\uFF23\u0106\u0108\u010A\u010C\u00C7\u1E08\u0187\u023B\uA73E'},
    {'base':'D', 'letters':'\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018B\u018A\u0189\uA779'},
    {'base':'DZ','letters':'\u01F1\u01C4'},
    {'base':'Dz','letters':'\u01F2\u01C5'},
    {'base':'E', 'letters':'\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E'},
    {'base':'F', 'letters':'\u0046\u24BB\uFF26\u1E1E\u0191\uA77B'},
    {'base':'G', 'letters':'\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E'},
    {'base':'H', 'letters':'\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D'},
    {'base':'I', 'letters':'\u0049\u24BE\uFF29\u00CC\u00CD\u00CE\u0128\u012A\u012C\u0130\u00CF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197'},
    {'base':'J', 'letters':'\u004A\u24BF\uFF2A\u0134\u0248'},
    {'base':'K', 'letters':'\u004B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2'},
    {'base':'L', 'letters':'\u004C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780'},
    {'base':'LJ','letters':'\u01C7'},
    {'base':'Lj','letters':'\u01C8'},
    {'base':'M', 'letters':'\u004D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C'},
    {'base':'N', 'letters':'\u004E\u24C3\uFF2E\u01F8\u0143\u00D1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u0220\u019D\uA790\uA7A4'},
    {'base':'NJ','letters':'\u01CA'},
    {'base':'Nj','letters':'\u01CB'},
    {'base':'O', 'letters':'\u004F\u24C4\uFF2F\u00D2\u00D3\u00D4\u1ED2\u1ED0\u1ED6\u1ED4\u00D5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\u00D6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u00D8\u01FE\u0186\u019F\uA74A\uA74C'},
    {'base':'OI','letters':'\u01A2'},
    {'base':'OO','letters':'\uA74E'},
    {'base':'OU','letters':'\u0222'},
    {'base':'OE','letters':'\u008C\u0152'},
    {'base':'oe','letters':'\u009C\u0153'},
    {'base':'P', 'letters':'\u0050\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754'},
    {'base':'Q', 'letters':'\u0051\u24C6\uFF31\uA756\uA758\u024A'},
    {'base':'R', 'letters':'\u0052\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782'},
    {'base':'S', 'letters':'\u0053\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784'},
    {'base':'T', 'letters':'\u0054\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786'},
    {'base':'TZ','letters':'\uA728'},
    {'base':'U', 'letters':'\u0055\u24CA\uFF35\u00D9\u00DA\u00DB\u0168\u1E78\u016A\u1E7A\u016C\u00DC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244'},
    {'base':'V', 'letters':'\u0056\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245'},
    {'base':'VY','letters':'\uA760'},
    {'base':'W', 'letters':'\u0057\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72'},
    {'base':'X', 'letters':'\u0058\u24CD\uFF38\u1E8A\u1E8C'},
    {'base':'Y', 'letters':'\u0059\u24CE\uFF39\u1EF2\u00DD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE'},
    {'base':'Z', 'letters':'\u005A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762'},
    {'base':'a', 'letters':'\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250'},
    {'base':'aa','letters':'\uA733'},
    {'base':'ae','letters':'\u00E6\u01FD\u01E3'},
    {'base':'ao','letters':'\uA735'},
    {'base':'au','letters':'\uA737'},
    {'base':'av','letters':'\uA739\uA73B'},
    {'base':'ay','letters':'\uA73D'},
    {'base':'b', 'letters':'\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253'},
    {'base':'c', 'letters':'\u0063\u24D2\uFF43\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184'},
    {'base':'d', 'letters':'\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\uA77A'},
    {'base':'dz','letters':'\u01F3\u01C6'},
    {'base':'e', 'letters':'\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u025B\u01DD'},
    {'base':'f', 'letters':'\u0066\u24D5\uFF46\u1E1F\u0192\uA77C'},
    {'base':'g', 'letters':'\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\u1D79\uA77F'},
    {'base':'h', 'letters':'\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265'},
    {'base':'hv','letters':'\u0195'},
    {'base':'i', 'letters':'\u0069\u24D8\uFF49\u00EC\u00ED\u00EE\u0129\u012B\u012D\u00EF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131'},
    {'base':'j', 'letters':'\u006A\u24D9\uFF4A\u0135\u01F0\u0249'},
    {'base':'k', 'letters':'\u006B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3'},
    {'base':'l', 'letters':'\u006C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747'},
    {'base':'lj','letters':'\u01C9'},
    {'base':'m', 'letters':'\u006D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F'},
    {'base':'n', 'letters':'\u006E\u24DD\uFF4E\u01F9\u0144\u00F1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5'},
    {'base':'nj','letters':'\u01CC'},
    {'base':'o', 'letters':'\u006F\u24DE\uFF4F\u00F2\u00F3\u00F4\u1ED3\u1ED1\u1ED7\u1ED5\u00F5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\u00F6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\u00F8\u01FF\u0254\uA74B\uA74D\u0275'},
    {'base':'oi','letters':'\u01A3'},
    {'base':'ou','letters':'\u0223'},
    {'base':'oo','letters':'\uA74F'},
    {'base':'p','letters':'\u0070\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755'},
    {'base':'q','letters':'\u0071\u24E0\uFF51\u024B\uA757\uA759'},
    {'base':'r','letters':'\u0072\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783'},
    {'base':'s','letters':'\u0073\u24E2\uFF53\u00DF\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B'},
    {'base':'t','letters':'\u0074\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787'},
    {'base':'tz','letters':'\uA729'},
    {'base':'u','letters': '\u0075\u24E4\uFF55\u00F9\u00FA\u00FB\u0169\u1E79\u016B\u1E7B\u016D\u00FC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289'},
    {'base':'v','letters':'\u0076\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C'},
    {'base':'vy','letters':'\uA761'},
    {'base':'w','letters':'\u0077\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73'},
    {'base':'x','letters':'\u0078\u24E7\uFF58\u1E8B\u1E8D'},
    {'base':'y','letters':'\u0079\u24E8\uFF59\u1EF3\u00FD\u0177\u1EF9\u0233\u1E8F\u00FF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF'},
    {'base':'z','letters':'\u007A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763'}
  ];

  var diacriticsMap = {};
  var len = defaultDiacriticsRemovalap.length;
  var letters, j, l;
  for (var i = 0; i < len; i++) {
    letters = defaultDiacriticsRemovalap[i].letters.split('');
    for (j = 0, l = letters.length; j < l; j++) {
      diacriticsMap[letters[j]] = defaultDiacriticsRemovalap[i].base;
    }
  }

  var removeDiacritics = function(s) {
    return s.replace(/[^\u0000-\u007E]/g, function(a) {
      return diacriticsMap[a] || a;
    });
  };

  // Japanese Hiragana and Katakana + HankakuKana
  var kanaAlphaMap = {
    'wha': ['\u3046\u3041', '\u30a6\u30a1', '\uff73\uff67'],
    'wi' : ['\u3046\u3043', '\u30a6\u30a3', '\uff73\uff68'],
    'we' : ['\u3046\u3047', '\u30a6\u30a7', '\uff73\uff6a'],
    'who': ['\u3046\u3049', '\u30a6\u30a9', '\uff73\uff6b'],
    'kya': ['\u304d\u3083', '\u30ad\u30e3', '\uff77\u30e3'],
    'kyi': ['\u304d\u3043', '\u30ad\u30a3', '\uff77\uff68'],
    'kyu': ['\u304d\u3085', '\u30ad\u30e5', '\uff77\u30e5'],
    'kye': ['\u304d\u3047', '\u30ad\u30a7', '\uff77\uff6a'],
    'kyo': ['\u304d\u3087', '\u30ad\u30e7', '\uff77\u30e7'],
    'qya': ['\u304f\u3083', '\u30af\u30e3', '\uff78\u30e3'],
    'qyu': ['\u304f\u3085', '\u30af\u30e5', '\uff78\u30e5'],
    'qwa': ['\u304f\u3041', '\u30af\u30a1', '\uff78\uff67'],
    'qwi': ['\u304f\u3043', '\u30af\u30a3', '\uff78\uff68'],
    'qwu': ['\u304f\u3045', '\u30af\u30a5', '\uff78\uff69'],
    'qwe': ['\u304f\u3047', '\u30af\u30a7', '\uff78\uff6a'],
    'qwo': ['\u304f\u3049', '\u30af\u30a9', '\uff78\uff6b'],
    'gya': ['\u304e\u3083', '\u30ae\u30e3', '\uff77\uff9e\u30e3'],
    'gyi': ['\u304e\u3043', '\u30ae\u30a3', '\uff77\uff9e\uff68'],
    'gyu': ['\u304e\u3085', '\u30ae\u30e5', '\uff77\uff9e\u30e5'],
    'gye': ['\u304e\u3047', '\u30ae\u30a7', '\uff77\uff9e\uff6a'],
    'gyo': ['\u304e\u3087', '\u30ae\u30e7', '\uff77\uff9e\u30e7'],
    'gwa': ['\u3050\u3041', '\u30b0\u30a1', '\uff78\uff9e\uff67'],
    'gwi': ['\u3050\u3043', '\u30b0\u30a3', '\uff78\uff9e\uff68'],
    'gwu': ['\u3050\u3045', '\u30b0\u30a5', '\uff78\uff9e\uff69'],
    'gwe': ['\u3050\u3047', '\u30b0\u30a7', '\uff78\uff9e\uff6a'],
    'gwo': ['\u3050\u3049', '\u30b0\u30a9', '\uff78\uff9e\uff6b'],
    'sha': ['\u3057\u3083', '\u30b7\u30e3', '\uff7c\u30e3'],
    'syi': ['\u3057\u3043', '\u30b7\u30a3', '\uff7c\uff68'],
    'shu': ['\u3057\u3085', '\u30b7\u30e5', '\uff7c\u30e5'],
    'sye': ['\u3057\u3047', '\u30b7\u30a7', '\uff7c\uff6a'],
    'sho': ['\u3057\u3087', '\u30b7\u30e7', '\uff7c\u30e7'],
    'swa': ['\u3059\u3041', '\u30b9\u30a1', '\uff7d\uff67'],
    'swi': ['\u3059\u3043', '\u30b9\u30a3', '\uff7d\uff68'],
    'swu': ['\u3059\u3045', '\u30b9\u30a5', '\uff7d\uff69'],
    'swe': ['\u3059\u3047', '\u30b9\u30a7', '\uff7d\uff6a'],
    'swo': ['\u3059\u3049', '\u30b9\u30a9', '\uff7d\uff6b'],
    'ja' : ['\u3058\u3083', '\u30b8\u30e3', '\uff7c\uff9e\u30e3'],
    'jyi': ['\u3058\u3043', '\u30b8\u30a3', '\uff7c\uff9e\uff68'],
    'ju' : ['\u3058\u3085', '\u30b8\u30e5', '\uff7c\uff9e\u30e5'],
    'jye': ['\u3058\u3047', '\u30b8\u30a7', '\uff7c\uff9e\uff6a'],
    'jo' : ['\u3058\u3087', '\u30b8\u30e7', '\uff7c\uff9e\u30e7'],
    'cha': ['\u3061\u3083', '\u30c1\u30e3', '\uff81\u30e3'],
    'tyi': ['\u3061\u3043', '\u30c1\u30a3', '\uff81\uff68'],
    'chu': ['\u3061\u3085', '\u30c1\u30e5', '\uff81\u30e5'],
    'tye': ['\u3061\u3047', '\u30c1\u30a7', '\uff81\uff6a'],
    'cho': ['\u3061\u3087', '\u30c1\u30e7', '\uff81\u30e7'],
    'tsa': ['\u3064\u3041', '\u30c4\u30a1', '\uff82\uff67'],
    'tsi': ['\u3064\u3043', '\u30c4\u30a3', '\uff82\uff68'],
    'tse': ['\u3064\u3047', '\u30c4\u30a7', '\uff82\uff6a'],
    'tso': ['\u3064\u3049', '\u30c4\u30a9', '\uff82\uff6b'],
    'tha': ['\u3066\u3083', '\u30c6\u30e3', '\uff83\u30e3'],
    'thi': ['\u3066\u3043', '\u30c6\u30a3', '\uff83\uff68'],
    'thu': ['\u3066\u3085', '\u30c6\u30e5', '\uff83\u30e5'],
    'the': ['\u3066\u3047', '\u30c6\u30a7', '\uff83\uff6a'],
    'tho': ['\u3066\u3087', '\u30c6\u30e7', '\uff83\u30e7'],
    'twa': ['\u3068\u3041', '\u30c8\u30a1', '\uff84\uff67'],
    'twi': ['\u3068\u3043', '\u30c8\u30a3', '\uff84\uff68'],
    'twu': ['\u3068\u3045', '\u30c8\u30a5', '\uff84\uff69'],
    'twe': ['\u3068\u3047', '\u30c8\u30a7', '\uff84\uff6a'],
    'two': ['\u3068\u3049', '\u30c8\u30a9', '\uff84\uff6b'],
    'dya': ['\u3062\u3083', '\u30c2\u30e3', '\uff81\uff9e\u30e3'],
    'dyi': ['\u3062\u3043', '\u30c2\u30a3', '\uff81\uff9e\uff68'],
    'dyu': ['\u3062\u3085', '\u30c2\u30e5', '\uff81\uff9e\u30e5'],
    'dye': ['\u3062\u3047', '\u30c2\u30a7', '\uff81\uff9e\uff6a'],
    'dyo': ['\u3062\u3087', '\u30c2\u30e7', '\uff81\uff9e\u30e7'],
    'dha': ['\u3067\u3083', '\u30c7\u30e3', '\uff83\uff9e\u30e3'],
    'dhi': ['\u3067\u3043', '\u30c7\u30a3', '\uff83\uff9e\uff68'],
    'dhu': ['\u3067\u3085', '\u30c7\u30e5', '\uff83\uff9e\u30e5'],
    'dhe': ['\u3067\u3047', '\u30c7\u30a7', '\uff83\uff9e\uff6a'],
    'dho': ['\u3067\u3087', '\u30c7\u30e7', '\uff83\uff9e\u30e7'],
    'dwa': ['\u3069\u3041', '\u30c9\u30a1', '\uff84\uff9e\uff67'],
    'dwi': ['\u3069\u3043', '\u30c9\u30a3', '\uff84\uff9e\uff68'],
    'dwu': ['\u3069\u3045', '\u30c9\u30a5', '\uff84\uff9e\uff69'],
    'dwe': ['\u3069\u3047', '\u30c9\u30a7', '\uff84\uff9e\uff6a'],
    'dwo': ['\u3069\u3049', '\u30c9\u30a9', '\uff84\uff9e\uff6b'],
    'nya': ['\u306b\u3083', '\u30cb\u30e3', '\uff86\u30e3'],
    'nyi': ['\u306b\u3043', '\u30cb\u30a3', '\uff86\uff68'],
    'nyu': ['\u306b\u3085', '\u30cb\u30e5', '\uff86\u30e5'],
    'nye': ['\u306b\u3047', '\u30cb\u30a7', '\uff86\uff6a'],
    'nyo': ['\u306b\u3087', '\u30cb\u30e7', '\uff86\u30e7'],
    'hya': ['\u3072\u3083', '\u30d2\u30e3', '\uff8b\u30e3'],
    'hyi': ['\u3072\u3043', '\u30d2\u30a3', '\uff8b\uff68'],
    'hyu': ['\u3072\u3085', '\u30d2\u30e5', '\uff8b\u30e5'],
    'hye': ['\u3072\u3047', '\u30d2\u30a7', '\uff8b\uff6a'],
    'hyo': ['\u3072\u3087', '\u30d2\u30e7', '\uff8b\u30e7'],
    'fya': ['\u3075\u3083', '\u30d5\u30e3', '\uff8c\u30e3'],
    'fyu': ['\u3075\u3085', '\u30d5\u30e5', '\uff8c\u30e5'],
    'fyo': ['\u3075\u3087', '\u30d5\u30e7', '\uff8c\u30e7'],
    'fa' : ['\u3075\u3041', '\u30d5\u30a1', '\uff8c\uff67'],
    'fi' : ['\u3075\u3043', '\u30d5\u30a3', '\uff8c\uff68'],
    'fwu': ['\u3075\u3045', '\u30d5\u30a5', '\uff8c\uff69'],
    'fe' : ['\u3075\u3047', '\u30d5\u30a7', '\uff8c\uff6a'],
    'fo' : ['\u3075\u3049', '\u30d5\u30a9', '\uff8c\uff6b'],
    'bya': ['\u3073\u3083', '\u30d3\u30e3', '\uff8b\uff9e\u30e3'],
    'byi': ['\u3073\u3043', '\u30d3\u30a3', '\uff8b\uff9e\uff68'],
    'byu': ['\u3073\u3085', '\u30d3\u30e5', '\uff8b\uff9e\u30e5'],
    'bye': ['\u3073\u3047', '\u30d3\u30a7', '\uff8b\uff9e\uff6a'],
    'byo': ['\u3073\u3087', '\u30d3\u30e7', '\uff8b\uff9e\u30e7'],
    'va' : ['\u3094\u3041', '\u30f4\u30a1', '\u30f4\uff67'],
    'vi' : ['\u3094\u3043', '\u30f4\u30a3', '\u30f4\uff68'],
    'vu' : ['\u3094', '\u30f4', '\u30f4'],
    've' : ['\u3094\u3047', '\u30f4\u30a7', '\u30f4\uff6a'],
    'vo' : ['\u3094\u3049', '\u30f4\u30a9', '\u30f4\uff6b'],
    'vya': ['\u3094\u3083', '\u30f4\u30e3', '\u30f4\u30e3'],
    'vyu': ['\u3094\u3085', '\u30f4\u30e5', '\u30f4\u30e5'],
    'vyo': ['\u3094\u3087', '\u30f4\u30e7', '\u30f4\u30e7'],
    'pya': ['\u3074\u3083', '\u30d4\u30e3', '\uff8b\uff9f\u30e3'],
    'pyi': ['\u3074\u3043', '\u30d4\u30a3', '\uff8b\uff9f\uff68'],
    'pyu': ['\u3074\u3085', '\u30d4\u30e5', '\uff8b\uff9f\u30e5'],
    'pye': ['\u3074\u3047', '\u30d4\u30a7', '\uff8b\uff9f\uff6a'],
    'pyo': ['\u3074\u3087', '\u30d4\u30e7', '\uff8b\uff9f\u30e7'],
    'mya': ['\u307f\u3083', '\u30df\u30e3', '\uff90\u30e3'],
    'myi': ['\u307f\u3043', '\u30df\u30a3', '\uff90\uff68'],
    'myu': ['\u307f\u3085', '\u30df\u30e5', '\uff90\u30e5'],
    'mye': ['\u307f\u3047', '\u30df\u30a7', '\uff90\uff6a'],
    'myo': ['\u307f\u3087', '\u30df\u30e7', '\uff90\u30e7'],
    'rya': ['\u308a\u3083', '\u30ea\u30e3', '\uff98\u30e3'],
    'ryi': ['\u308a\u3043', '\u30ea\u30a3', '\uff98\uff68'],
    'ryu': ['\u308a\u3085', '\u30ea\u30e5', '\uff98\u30e5'],
    'rye': ['\u308a\u3047', '\u30ea\u30a7', '\uff98\uff6a'],
    'ryo': ['\u308a\u3087', '\u30ea\u30e7', '\uff98\u30e7'],
    'a'  : ['\u3042', '\u30a2', '\uff71'],
    'i'  : ['\u3044', '\u30a4', '\uff72'],
    'u'  : ['\u3046', '\u30a6', '\uff73'],
    'e'  : ['\u3048', '\u30a8', '\uff74'],
    'o'  : ['\u304a', '\u30aa', '\uff75'],
    'ka' : ['\u304b', '\u30ab', '\uff76'],
    'ki' : ['\u304d', '\u30ad', '\uff77'],
    'ku' : ['\u304f', '\u30af', '\uff78'],
    'ke' : ['\u3051', '\u30b1', '\uff79'],
    'ko' : ['\u3053', '\u30b3', '\uff7a'],
    'sa' : ['\u3055', '\u30b5', '\uff7b'],
    'shi': ['\u3057', '\u30b7', '\uff7c'],
    'su' : ['\u3059', '\u30b9', '\uff7d'],
    'se' : ['\u305b', '\u30bb', '\uff7e'],
    'so' : ['\u305d', '\u30bd', '\uff7f'],
    'ta' : ['\u305f', '\u30bf', '\uff80'],
    'chi': ['\u3061', '\u30c1', '\uff81'],
    'tsu': ['\u3064', '\u30c4', '\uff82'],
    'te' : ['\u3066', '\u30c6', '\uff83'],
    'to' : ['\u3068', '\u30c8', '\uff84'],
    'na' : ['\u306a', '\u30ca', '\uff85'],
    'ni' : ['\u306b', '\u30cb', '\uff86'],
    'nu' : ['\u306c', '\u30cc', '\uff87'],
    'ne' : ['\u306d', '\u30cd', '\uff88'],
    'no' : ['\u306e', '\u30ce', '\uff89'],
    'ha' : ['\u306f', '\u30cf', '\uff8a'],
    'hi' : ['\u3072', '\u30d2', '\uff8b'],
    'fu' : ['\u3075', '\u30d5', '\uff8c'],
    'he' : ['\u3078', '\u30d8', '\uff8d'],
    'ho' : ['\u307b', '\u30db', '\uff8e'],
    'ma' : ['\u307e', '\u30de', '\uff8f'],
    'mi' : ['\u307f', '\u30df', '\uff90'],
    'mu' : ['\u3080', '\u30e0', '\uff91'],
    'me' : ['\u3081', '\u30e1', '\uff92'],
    'mo' : ['\u3082', '\u30e2', '\uff93'],
    'ya' : ['\u3084', '\u30e4', '\uff94'],
    'yu' : ['\u3086', '\u30e6', '\uff95'],
    'yo' : ['\u3088', '\u30e8', '\uff96'],
    'ra' : ['\u3089', '\u30e9', '\uff97'],
    'ri' : ['\u308a', '\u30ea', '\uff98'],
    'ru' : ['\u308b', '\u30eb', '\uff99'],
    're' : ['\u308c', '\u30ec', '\uff9a'],
    'ro' : ['\u308d', '\u30ed', '\uff9b'],
    'wa' : ['\u308f', '\u30ef', '\uff9c'],
    'wo' : ['\u3092', '\u30f2', '\uff66'],
    'nn' : ['\u3093', '\u30f3', '\uff9d'],
    'ga' : ['\u304c', '\u30ac', '\uff76\uff9e'],
    'gi' : ['\u304e', '\u30ae', '\uff77\uff9e'],
    'gu' : ['\u3050', '\u30b0', '\uff78\uff9e'],
    'ge' : ['\u3052', '\u30b2', '\uff79\uff9e'],
    'go' : ['\u3054', '\u30b4', '\uff7a\uff9e'],
    'za' : ['\u3056', '\u30b6', '\uff7b\uff9e'],
    'zi' : ['\u3058', '\u30b8', '\uff7c\uff9e'],
    'zu' : ['\u305a', '\u30ba', '\uff7d\uff9e'],
    'ze' : ['\u305c', '\u30bc', '\uff7e\uff9e'],
    'zo' : ['\u305e', '\u30be', '\uff7f\uff9e'],
    'da' : ['\u3060', '\u30c0', '\uff80\uff9e'],
    'di' : ['\u3062', '\u30c2', '\uff81\uff9e'],
    'du' : ['\u3065', '\u30c5', '\uff82\uff9e'],
    'de' : ['\u3067', '\u30c7', '\uff83\uff9e'],
    'do' : ['\u3069', '\u30c9', '\uff84\uff9e'],
    'ba' : ['\u3070', '\u30d0', '\uff8a\uff9e'],
    'bi' : ['\u3073', '\u30d3', '\uff8b\uff9e'],
    'bu' : ['\u3076', '\u30d6', '\uff8c\uff9e'],
    'be' : ['\u3079', '\u30d9', '\uff8d\uff9e'],
    'bo' : ['\u307c', '\u30dc', '\uff8e\uff9e'],
    'pa' : ['\u3071', '\u30d1', '\uff8a\uff9f'],
    'pi' : ['\u3074', '\u30d4', '\uff8b\uff9f'],
    'pu' : ['\u3077', '\u30d7', '\uff8c\uff9f'],
    'pe' : ['\u307a', '\u30da', '\uff8d\uff9f'],
    'po' : ['\u307d', '\u30dd', '\uff8e\uff9f'],
    'la' : ['\u3041', '\u30a1', '\uff67'],
    'li' : ['\u3043', '\u30a3', '\uff68'],
    'lu' : ['\u3045', '\u30a5', '\uff69'],
    'le' : ['\u3047', '\u30a7', '\uff6a'],
    'lo' : ['\u3049', '\u30a9', '\uff6b'],
    'lka': ['\u3095', '\u30f5', '\u30f5'],
    'lke': ['\u3096', '\u30f6', '\u30f6'],
    'ltu': ['\u3063', '\u30c3', '\uff6f'],
    'lya': ['\u3083', '\u30e3', '\u30e3'],
    'lyu': ['\u3085', '\u30e5', '\u30e5'],
    'lyo': ['\u3087', '\u30e7', '\u30e7'],
    'lwa': ['\u308e', '\u30ee', '\u30ee'],
    '.'  : ['\u3002', '\u3002', '\u3002'],
    ', ' : ['\u3001', '\u3001', '\u3001'],
    '-'  : ['\u30fc', '\u30fc', '\uff70']
  };

  var kanaToAlpha = function(s) {
    var kanji = '?';
    var t = '\uffff';

    // kanji
    s = s.replace(/[\u4e9c-\u7199]+/g, t);

    Object.keys(kanaAlphaMap).forEach(function(alpha) {
      var kanas = this[alpha];
      for (var i = 0, len = kanas.length; i < len; i++) {
        s = s.split(kanas[i]).join(alpha);
      }
    }, kanaAlphaMap);

    s = s.replace(/[\uffff]+/g, kanji);

    return s;
  };


  var toAscii = function(s) {
    s = removeDiacritics(kanaToAlpha(s))
      .replace(/[^\u0000-\u007E]/g, '\uffff')
      .replace(/[\uffff]+/g, '?');

    return s;
  };

  return toAscii;
}());


return [global, exports, require];
}).apply(this, (function(global, exports, require, module) {


Object.defineProperty(module, 'exports', {
  get: function() {
    return exports;
  },
  set: function(v) {
    delete module.exports;
    exports.promise = v;
  },
  enumerable: true,
  configurable: true
});


// Promise from http://promisesaplus.com/implementations#i-promise
// https://github.com/then/promise
// Modified for the Pebble JavaScript Framework and CloudPebble JSHint warnings
(function(e){if("function"==typeof bootstrap)bootstrap("promise",e);else if("object"==typeof exports)module.exports=e();
else if("function"==typeof define&&define.amd)define(e);else if("undefined"!=typeof ses){if(!ses.ok())return;ses.makePromise=e}
else"undefined"!=typeof window?window.Promise=e():global.Promise=e()})(function(){var define,ses,bootstrap,module,exports;
return (function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);
if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0].call(u.exports,function(t){
var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;
for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined' && window.setImmediate;
    var canPost = typeof window !== 'undefined' && window.postMessage &&
        window.addEventListener;

    if (canSetImmediate) {
        return function (f) {
          return window.setImmediate(f);
        };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/'; };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],2:[function(require,module,exports){
'use strict';

var nextTick = require('./lib/next-tick');

module.exports = Promise;
function Promise(fn) {
  if (!(this instanceof Promise)) return new Promise(fn);
  if (typeof fn !== 'function') throw new TypeError('not a function');
  var state = null;
  var delegating = false;
  var value = null;
  var deferreds = [];
  var self = this;

  this.then = function(onFulfilled, onRejected) {
    return new Promise(function(resolve, reject) {
      handle(new Handler(onFulfilled, onRejected, resolve, reject));
    });
  };

  function handle(deferred) {
    if (state === null) {
      deferreds.push(deferred);
      return;
    }
    nextTick(function() {
      var cb = state ? deferred.onFulfilled : deferred.onRejected;
      if (cb === null) {
        (state ? deferred.resolve : deferred.reject)(value);
        return;
      }
      var ret;
      try {
        ret = cb(value);
      }
      catch (e) {
        deferred.reject(e);
        return;
      }
      deferred.resolve(ret);
    });
  }

  function resolve(newValue) {
    if (delegating)
      return;
    resolve_(newValue);
  }

  function resolve_(newValue) {
    if (state !== null)
      return;
    try { //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
      if (newValue === self) throw new TypeError('A promise cannot be resolved with itself.');
      if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
        var then = newValue.then;
        if (typeof then === 'function') {
          delegating = true;
          then.call(newValue, resolve_, reject_);
          return;
        }
      }
      state = true;
      value = newValue;
      finale();
    } catch (e) { reject_(e); }
  }

  function reject(newValue) {
    if (delegating)
      return;
    reject_(newValue);
  }

  function reject_(newValue) {
    if (state !== null)
      return;
    state = false;
    value = newValue;
    finale();
  }

  function finale() {
    for (var i = 0, len = deferreds.length; i < len; i++)
      handle(deferreds[i]);
    deferreds = null;
  }

  try { fn(resolve, reject); }
  catch(e) { reject(e); }
}


function Handler(onFulfilled, onRejected, resolve, reject){
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.resolve = resolve;
  this.reject = reject;
}

},{"./lib/next-tick":4}],3:[function(require,module,exports){
'use strict';

//This file contains then/promise specific extensions to the core promise API

var Promise = require('./core.js');
var nextTick = require('./lib/next-tick');

module.exports = Promise;

/* Static Functions */

Promise.from = function (value) {
  if (value instanceof Promise) return value;
  return new Promise(function (resolve) { resolve(value); });
};
Promise.denodeify = function (fn) {
  return function () {
    var self = this;
    var args = Array.prototype.slice.call(arguments);
    return new Promise(function (resolve, reject) {
      args.push(function (err, res) {
        if (err) reject(err);
        else resolve(res);
      });
      fn.apply(self, args);
    });
  };
};
Promise.nodeify = function (fn) {
  return function () {
    var args = Array.prototype.slice.call(arguments);
    var callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    try {
      return fn.apply(this, arguments).nodeify(callback);
    } catch (ex) {
      if (callback === null || callback === void 0) {
        return new Promise(function (resolve, reject) { reject(ex); });
      } else {
        nextTick(function () {
          callback(ex);
        });
      }
    }
  };
};

Promise.all = function () {
  var args = Array.prototype.slice.call(arguments.length === 1 && Array.isArray(arguments[0]) ? arguments[0] : arguments);

  return new Promise(function (resolve, reject) {
    if (args.length === 0) return resolve([]);
    var remaining = args.length;
    function res(i, val) {
      try {
        if (val && (typeof val === 'object' || typeof val === 'function')) {
          var then = val.then;
          if (typeof then === 'function') {
            then.call(val, function (val) { res(i, val); }, reject);
            return;
          }
        }
        args[i] = val;
        if (--remaining === 0) {
          resolve(args);
        }
      } catch (ex) {
        reject(ex);
      }
    }
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

/* Prototype Methods */

Promise.prototype.done = function (onFulfilled, onRejected) {
  var self = arguments.length ? this.then.apply(this, arguments) : this;
  self.then(null, function (err) {
    nextTick(function () {
      throw err;
    });
  });
};

Promise.prototype.nodeify = function (callback) {
  if (callback === null || callback === void 0) return this;

  this.then(function (value) {
    nextTick(function () {
      callback(null, value);
    });
  }, function (err) {
    nextTick(function () {
      callback(err);
    });
  });
};
},{"./core.js":2,"./lib/next-tick":4}],4:[function(require,module,exports){
(function(process){'use strict';

if (typeof setImmediate === 'function') { // IE >= 10 & node.js >= 0.10
  module.exports = function(fn){ setImmediate(fn); };
} else if (typeof process !== 'undefined' && process && typeof process.nextTick === 'function') { // node.js before 0.10
  module.exports = function(fn){ process.nextTick(fn); };
} else {
  module.exports = function(fn){ setTimeout(fn, 0); };
}

})(require("__browserify_process"));
},{"__browserify_process":1}]},{},[3])(3);
});

  return [global, exports, require];
}).apply(this, (function(global) {
  'use strict';

  var exports = {};
  var module = {};

  var require = function(request) {
    var m = exports[request];
    if (m) {
      return m;
    }

    var key, keys = Object.keys(exports);
    for (var i = 0, len = keys.length; i < len; i++) {
      key = keys[i];
      if (key.toLowerCase() === request) {
        return exports[key];
      }
    }
  };

  return [global, exports, require, module];
}(this)))));

