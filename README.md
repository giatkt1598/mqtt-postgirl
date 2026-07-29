# MQTT - PostGirl

Local-first MQTT test tool with collection/request CRUD, environment management, template helpers, publish/batch publish, consumer sessions, and realtime logs.

## Run locally

```bash
npm install
npm run dev
```

Server: `http://localhost:3000`
Web dev server: `http://localhost:5173`

## Docker

```bash
docker compose up --build
```

## Default flow

1. Create a broker profile.
2. Create an environment.
3. Create a collection and requests.
4. Use `{{now}}`, `{{uuid}}`, `{{env.NAME}}`, or custom helpers in payload templates.
5. Publish one message or batch publish many messages.
6. Start a consumer session and watch the message stream.
