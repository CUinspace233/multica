# nginx: WebSocket 与 SSE 流式响应的必备配置

自部署 Multica 时，浏览器到 backend 的路径上**几乎一定有一层 nginx**（本仓库的 `bin/deploy.sh` 示例就是 nginx 终结 TLS 再转发到 `127.0.0.1:8080`）。如果 nginx 配置不当，**chat 流式回复和实时通知会全部坏掉**，症状是：

- 发消息后 UI 卡在 "Queued"，必须刷新页面才看到完整回复（SSE 被 nginx 缓冲）
- DevTools WS Frames 标签里**完全空**，没有心跳、没有 `chat:done` 事件（WS 被路由到了错的上游）

本节解释为什么会发生，以及怎么配。

## 路径

Multica 默认架构（参考 `apps/web/proxy.ts` + `apps/web/next.config.ts`）：

```
浏览器
  │
  ▼ HTTPS
nginx (multica.cuinspace.com:443)
  │
  ├── /api/*         ──→  127.0.0.1:8080  (backend)
  ├── /ws            ──→  127.0.0.1:8080  (backend)
  ├── /uploads/*     ──→  127.0.0.1:3000  (Next.js, 由 proxy.ts rewrite 到 backend)
  ├── /auth/*        ──→  127.0.0.1:3000  (Next.js, 由 proxy.ts rewrite 到 backend)
  └── 其他            ──→  127.0.0.1:3000  (Next.js 前端页面)
```

**关键点**：浏览器对 `/api/*` 和 `/ws` 走 same-origin（容器里 `NEXT_PUBLIC_API_URL` 没设），所以 nginx 这一层必须**显式匹配**这两个前缀并直接打到 backend。如果让它们掉进兜底的 `location /`，请求会去 Next.js frontend（port 3000）—— Next.js production server **不代理 WebSocket**，握手返回 101 后 frames 全部丢失。

## 最小可工作的 nginx 配置

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name multica.cuinspace.com;

    # ... TLS / certbot 配置略 ...

    client_max_body_size 50m;

    # WebSocket — 必须在 location / 之前显式匹配 /ws 和 /ws/*
    location ~ ^/ws(/.*)?$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade          $http_upgrade;
        proxy_set_header Connection       "upgrade";
        proxy_set_header Host             $host;
        proxy_set_header X-Real-IP        $remote_addr;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout  86400s;
        proxy_send_timeout  86400s;
        proxy_buffering     off;          # WS 不能缓冲
    }

    # /api/* 直走 backend — chat 流式回复走 SSE
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering     off;          # SSE chunked 透传
        proxy_cache         off;          # 不缓存
        proxy_read_timeout  300s;         # 长 streaming
    }

    # 兜底: 前端页面 + JS chunks
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## 为什么每个配置项都必需

### `location ~ ^/ws(/.*)?$` 必须显式存在，且必须在 `location /` 之前

nginx 按顺序匹配 `location`。如果 `/ws` 没显式块，请求掉进兜底 `location /` → 打到 Next.js frontend → Next.js production server 不代理 WS → nginx 仍然返回 101（握手层是 nginx 自己回的吗？不是，是 upstream 的响应码；这里 upstream 不知道这是 WS，会回 404，nginx 把 404 转成 101 是**错的**，实际 frames 一字节不通）。

`^/ws(/.*)?$` 用 regex `~` 而不是 prefix，是为了**精确**匹配 `/ws` 和 `/ws/foo`，不误伤 `/workspace` 这种路径。

### `proxy_http_version 1.1;`

WebSocket **必须** HTTP/1.1。nginx 默认跟 upstream 是 HTTP/1.0，缺这一行会看到 400 Bad Request。

### `Upgrade` + `Connection "upgrade"` 两个 header

告诉 nginx 把这两个头原样透传给 backend。没有这两行 backend 不知道是 WS 请求，会按普通 HTTP 处理。

### `proxy_buffering off;`（两个 location 都要）

**这是 SSE 问题的根因**：nginx 默认 `proxy_buffering on`——把整个响应收齐（攒满 `proxy_buffer_size` × `proxy_buffers`）再发给客户端。SSE 是 chunked 永远不结束的长响应，被 nginx 攒到 `proxy_read_timeout` 才一次性发给浏览器，浏览器自然就 "卡 Queued"。关掉之后 nginx 一收到 chunk 立刻转发，浏览器看到一帧帧 `data: {...}`。

### `proxy_cache off;`（`/api/` 那块）

SSE 响应**绝对不能缓存**——否则下一个用户会收到上一个用户的流。`proxy_buffering off` 不等于 `proxy_cache off`，两者独立。

### `proxy_read_timeout 300s;`（`/api/` 那块）

nginx 默认 `proxy_read_timeout 60s`，SSE 流式响应超过 60 秒 nginx 会主动掐连接（报 504）。300 秒是经验值，够长但不阻塞；想保险设 3600s 也可以。

WS 那块的 `proxy_read_timeout 86400s`（24 小时）同理——WS 长连接默认 60 秒也会被切。

### `client_max_body_size 50m;`

附件上传（multipart/form-data）的最大体积。默认 1m 会让上传失败。

## 验证清单

配好后跑一遍：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

然后从浏览器 F12 → Network 检查：

1. **WS 通**：Network → WS → Frames 标签里应该有持续滚的心跳帧（每 25–30s 一条）。点开发消息那次操作的 WS，看到 `chat:done` / `task:completed` 帧。
2. **SSE 通**：发一条消息，Network 里找到那个 `POST /api/chat/sessions/.../messages`，看：
   - Response Headers 里 `Content-Type: text/event-stream` ✓
   - Timing 标签里 Content Download 是**持续滚动**（不是 Processing 结束后一瞬间完成）✓
   - Response 标签里能看到多个 `data: {...}` 帧 ✓

如果 SSE 仍卡 Queued，回到 nginx 配置确认：
- `location /api/` 的 `proxy_buffering off;` 没被覆盖（嵌套 block 会 reset）
- 没开 `gzip`（nginx 默认 `gzip on` 对 SSE 也会有问题，需要 `gzip off;`）

如果 WS Frames 仍空，确认：
- 浏览器地址栏的 WS URL 是 `wss://multica.cuinspace.com/ws?...`，不是 `wss://api.cuinspace.com/ws?...`——前者走 multica vhost，后者走 api vhost，两个 vhost 都要配对
- backend 日志（`docker logs multica-backend-1`）里能看到 upgrade 请求到达

## 为什么 `api.cuinspace.com` 看起来"没事"

如果你参考本仓库的 `bin/deploy.sh` 起了 `api.cuinspace.com` vhost，那是**专门给 backend 准备的**——`/ws` 直走 backend，`location /` 也是 backend。Multica Cloud 用的是同源 + 自己的边缘代理，所以从浏览器看 `multica.cuinspace.com` 的 `/api` 和 `/ws` 必须由这层 nginx 显式转发到 backend，不能让前端兜底。

## 如果你前面挂了 Cloudflare

Cloudflare 默认支持 WebSocket 和流式响应，但免费版有 100 秒 idle 超时会切 WS。两种常见部署模式：

1. **Cloudflare 全程代理（橙色云）**：WS 会被 Cloudflare 边缘终结后再连你 origin。前面那段 WS + SSE 的 nginx 配置仍然需要（Cloudflare 不是 nginx），Cloudflare 自己不会缓冲 SSE。
2. **Cloudflare DNS only（灰色云）**：Cloudflare 只做 DNS 解析，浏览器直连你 origin 的 443。前面那段 nginx 配置是唯一需要担心的层。代价是失去 DDoS 防护。

更激进的方案是 Cloudflare Tunnel（`cloudflared tunnel`），它从你主机主动 outbound 建长连接，**没有 idle timeout、没有 frame 丢包**，但要额外部署 daemon。

## 跟 CI/CD 的关系

`bin/deploy.sh` 和 `multica-build-and-reload.sh`（CI 用的 wrapper）只动 `/opt/multica/.env` 和 docker 容器，**不碰 nginx 配置**。nginx 配置是 host-side 的手工维护项——CI 改了它也没用，因为 reload 之后 `systemctl reload multica-stack` 不会重新读 nginx。

修改 nginx 后**手动**：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果想 CI 也管 nginx，加一个受限 sudoers 命令：

```
Cmnd_Alias MULTICA_NGINX = \
  /usr/bin/nginx -t, \
  /usr/bin/systemctl reload nginx
deploy ALL=(root) NOPASSWD: MULTICA_NGINX, MULTICA_RELOAD
```

——但要确保 workflow 里只有 reload 没有 restart，且 reload 之前有 `nginx -t` 兜底。
