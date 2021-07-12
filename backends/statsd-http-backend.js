/*
 * To enable this backend, include 'statsd-http-backend' in the backends
 * configuration array:
 *
 *   backends: ['statsd-http-backend']
 *
 * This backend supports the following config options:
 *
 *   bridgeURL: URL of the HTTP bridge.
 *   api_key: API key for Basic authentication, passed in "Authorization" header.
 */

var net = require('net'),
    util = require('util'),
    http = require('http'),
    https = require('https'),
    url = require('url');

var debug;
var flushInterval;
var bridgeURL;
var api_key;

// prefix configuration
var globalPrefix;
var prefixPersecond;
var prefixCounter;
var prefixTimer;
var prefixGauge;
var prefixSet;
var prefixStats;

// set up namespaces
var legacyNamespace  = true;
var globalNamespace  = [];
var counterNamespace = [];
var timerNamespace   = [];
var gaugesNamespace  = [];
var setsNamespace    = [];

var httpStats = {};

function metric(path, val, timestamp, type) {
    var pathParts = path.split(";")
    // Metric name
    var metric = pathParts.find(p => p.indexOf("=") === -1);
    var thisMetric = this;
    // Tags
    pathParts
      .filter(p => p.indexOf('=') !== -1)
      .map(p => p.split("=", 2))
      .filter(ts => ts.length == 2)
      .forEach(ts => thisMetric[ts[0]] = ts[1]);
    this.metric = metric != null ? metric : "undefined";
    this.value = val;
    this.timestamp = timestamp;
    this.type = type;
}

var post_stats = function http_post_stats(metricsArray) {
  var last_flush = httpStats.last_flush || 0;
  var last_exception = httpStats.last_exception || 0;
  var flush_time = httpStats.flush_time || 0;
  var flush_length = httpStats.flush_length || 0;

  if (bridgeURL) {
    try {
      var starttime = Date.now();
      var ts = Math.round(new Date().getTime() / 1000);
      var namespace = globalNamespace.concat(prefixStats).join(".");

      metricsArray.push(new metric(namespace + '.httpStats.last_exception', last_exception, ts, "gauge"));
      metricsArray.push(new metric(namespace + '.httpStats.last_flush', last_flush, ts, "gauge"));
      metricsArray.push(new metric(namespace + '.httpStats.flush_time', flush_time, ts, "timer"));
      metricsArray.push(new metric(namespace + '.httpStats.flush_length', flush_length, ts, "timer"));

      var data = JSON.stringify(metricsArray);

      var options = url.parse(bridgeURL);
      options.method = 'POST';
      options.headers = {
        'Authorization': 'Basic ' + Buffer.from(api_key).toString('base64'),
        'Content-Length': data.length
      };

      var req;

      if(options.protocol === 'https:'){
        req = https.request(options, function(res) {
          res.setEncoding('utf8');
        });
      } else {
        req = http.request(options, function(res) {
          res.setEncoding('utf8');
        });
      }

      req.on('error', function(e) {
        console.log('problem with request: ' + e.message);
        httpStats.last_exception = Math.round(new Date().getTime() / 1000);
      });

      req.on('close', function(e){
        httpStats.flush_time = (Date.now() - starttime);
        httpStats.flush_length = data.length;
        httpStats.last_flush = Math.round(new Date().getTime() / 1000);
      });

      req.write(data);
      req.end();
    } catch(e){
      if (debug) {
        util.log(e);
      }
      httpStats.last_exception = Math.round(new Date().getTime() / 1000);
    }
  }
};

var flush_stats = function http_flush(ts, metrics) {
  var starttime = Date.now();
  var metricsArray = [];
  var numStats = 0;
  var key;
  var timer_data_key;
  var counters = metrics.counters;
  var gauges = metrics.gauges;
  var timers = metrics.timers;
  var sets = metrics.sets;
  var counter_rates = metrics.counter_rates;
  var timer_data = metrics.timer_data;
  var statsd_metrics = metrics.statsd_metrics;

  for (key in counters) {
    var namespace = counterNamespace.concat(key);
    var value = counters[key];
    var valuePerSecond = counter_rates[key]; // pre-calculated "per second" rate

    if (legacyNamespace === true) {
      metricsArray.push(new metric(namespace.join("."), valuePerSecond, ts, "gauge"));
      metricsArray.push(new metric('stats_counts.' + key, value, ts, "count"));
    } else {
      metricsArray.push(new metric(namespace.concat('rate').join("."), valuePerSecond, ts, "gauge"));
      metricsArray.push(new metric(namespace.concat('count').join("."), value, ts, "count"));
    }
  }

  for (key in timer_data) {
    var namespace = timerNamespace.concat(key);
    var the_key = namespace.join(".");
    for (timer_data_key in timer_data[key]) {
      if (typeof(timer_data[key][timer_data_key]) === 'number') {
        metricsArray.push(new metric(the_key + '.' + timer_data_key, timer_data[key][timer_data_key], ts, "timer"));
      } else {
        for (var timer_data_sub_key in timer_data[key][timer_data_key]) {
          var mpath = the_key + '.' + timer_data_key + '.' + timer_data_sub_key;
          var mval = timer_data[key][timer_data_key][timer_data_sub_key]
          if (debug) {
            util.log(mval.toString());
          }
          metricsArray.push(new metric(mpath, mval, ts, "timer"));
        }
      }
    }
  }

  for (key in gauges) {
    var namespace = gaugesNamespace.concat(key);
    metricsArray.push(new metric(namespace.join("."), gauges[key], ts, "gauge"));
  }

  for (key in sets) {
    var namespace = setsNamespace.concat(key);
    metricsArray.push(new metric(namespace.join(".") + '.count', sets[key].values().length, ts, "set"));
  }

  var namespace = globalNamespace.concat(prefixStats);
  if (legacyNamespace === true) {
    metricsArray.push(new metric(prefixStats + '.numStats', numStats, ts, "count"));
    metricsArray.push(new metric('stats.' + prefixStats + '.httpStats.calculationtime', (Date.now() - starttime), ts, "timer"));
    for (key in statsd_metrics) {
      metricsArray.push(new metric('stats.' + prefixStats + '.' + key, statsd_metrics[key], ts, "statsd"));
    }
  } else {
    metricsArray.push(new metric(namespace.join(".") + '.numStats', numStats, ts, "count"));
    metricsArray.push(new metric(namespace.join(".") + '.httpStats.calculationtime', (Date.now() - starttime), ts, "timer"));
    for (key in statsd_metrics) {
      var the_key = namespace.concat(key);
      metricsArray.push(new metric(the_key.join("."), statsd_metrics[key], ts, "statsd"));
    }
  }

  post_stats(metricsArray);
};

var backend_status = function http_status(writeCb) {
  for (var stat in httpStats) {
    writeCb(null, 'http', stat, httpStats[stat]);
  }
};

exports.init = function http_init(startup_time, config, events) {
  debug = config.debug;
  bridgeURL = config.bridgeURL;
  api_key = config.api_key;
  config.http = config.http || {};
  globalPrefix    = config.http.globalPrefix;
  prefixCounter   = config.http.prefixCounter;
  prefixTimer     = config.http.prefixTimer;
  prefixGauge     = config.http.prefixGauge;
  prefixSet       = config.http.prefixSet;
  legacyNamespace = config.http.legacyNamespace;
  prefixStats     = config.prefixStats;

  // set defaults for prefixes
  globalPrefix  = globalPrefix !== undefined ? globalPrefix : "stats";
  prefixCounter = prefixCounter !== undefined ? prefixCounter : "counters";
  prefixTimer   = prefixTimer !== undefined ? prefixTimer : "timers";
  prefixGauge   = prefixGauge !== undefined ? prefixGauge : "gauges";
  prefixSet     = prefixSet !== undefined ? prefixSet : "sets";
  prefixStats   = prefixStats !== undefined ? prefixStats : "statsd";
  legacyNamespace = legacyNamespace !== undefined ? legacyNamespace : true;


  if (legacyNamespace === false) {
    if (globalPrefix !== "") {
      globalNamespace.push(globalPrefix);
      counterNamespace.push(globalPrefix);
      timerNamespace.push(globalPrefix);
      gaugesNamespace.push(globalPrefix);
      setsNamespace.push(globalPrefix);
    }

    if (prefixCounter !== "") {
      counterNamespace.push(prefixCounter);
    }
    if (prefixTimer !== "") {
      timerNamespace.push(prefixTimer);
    }
    if (prefixGauge !== "") {
      gaugesNamespace.push(prefixGauge);
    }
    if (prefixSet !== "") {
      setsNamespace.push(prefixSet);
    }
  } else {
      globalNamespace = ['stats'];
      counterNamespace = ['stats'];
      timerNamespace = ['stats', 'timers'];
      gaugesNamespace = ['stats', 'gauges'];
      setsNamespace = ['stats', 'sets'];
  }

  httpStats.last_flush = startup_time;
  httpStats.last_exception = startup_time;
  httpStats.flush_time = 0;
  httpStats.flush_length = 0;

  flushInterval = config.flushInterval;

  events.on('flush', flush_stats);
  events.on('status', backend_status);

  return true;
};
