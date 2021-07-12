FROM statsd/statsd:latest
WORKDIR /usr/src/app
# Copy the backend source code instead of an installation since there are no dependencies
COPY ./backends/statsd-http-backend.js ./backends/statsd-http-backend.js
# Start statsd
CMD [ "node", "stats.js", "config.js" ]
