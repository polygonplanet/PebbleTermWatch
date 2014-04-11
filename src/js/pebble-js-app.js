var sendTimezoneToWatch = function() {
  // Get the number of seconds to add to convert localtime to utc
  var offsetSeconds = new Date().getTimezoneOffset() * 60;

  console.log('offsetSeconds=' + offsetSeconds);
  localStorage.setItem('timezoneOffset', offsetSeconds);

  // Send it to the watch
  Pebble.sendAppMessage({ timezoneOffset: offsetSeconds });
};

Pebble.addEventListener('ready', function(e) {
  sendTimezoneToWatch();
});
