statsd-http-backend
===================

POSTS Data in JSON List format to an HTTP Backend

installation
============

   npm install statsd-graphite-http-backend

usage
=====

In config.js:  

```
{
  backends: [ "./backends/statsd-http-backend" ],
  api_key: 'user:password',
  bridgeURL: 'http://host:port/publish'
}
```
