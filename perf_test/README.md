
This folder contains a tiny, safe sample website you can use as a target for local performance tests.
 
Author: opinderpalgill

Run:

# Performance Test Site

This folder contains a tiny, safe local performance test site you can use as a target for experiments.

Author: opinderpalgill

## Run

```bash
cd "$(pwd)/sample_site"
node server.js
# open http://localhost:4000/ in your browser
```

## Endpoints

- GET / -> index page with buttons
- GET /api/delay?ms=500 -> waits ms then returns JSON
- GET /api/cpu?ms=100 -> busy-loop for ms milliseconds
- GET /api/stream?chunks=5&delay=200 -> chunked streaming response
- GET /api/error -> returns HTTP 500

Use this with the project runner safely by starting this server and then pointing the runner at `http://localhost:4000/`.
