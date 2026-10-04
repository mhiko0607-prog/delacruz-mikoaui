# LavaLust UI

This folder contains the standalone Vue frontend. The LavaLust PHP application
in `../lavalust` remains the backend and provides the authentication and
product APIs.

## Run with Laragon

Keep `lavalust` and `lavalustui` as sibling folders under the web root and open:

```text
http://localhost/project-crud/lavalustui/
```

The frontend derives the API URL from this sibling layout and calls
`../lavalust/api`. The LavaLust backend must be configured with its database
and JWT secrets in `lavalust/.env`.

## Run on a separate origin

If you serve the frontend from a different host or port, set
`window.LAVALUST_API_BASE_URL` in `config.js` to the backend's absolute API URL,
for example `http://localhost/project-crud/lavalust/api`. Then set
`LAVALUST_UI_ORIGIN` in `lavalust/.env` to the frontend's exact origin (scheme,
host, and port), such as `http://localhost:5500`, and restart the PHP server.

The API only returns CORS permission to the configured frontend origin. The
existing API tester origin remains allowed.
