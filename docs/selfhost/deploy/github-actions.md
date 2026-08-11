# GitHub Actions → self-host 自动部署

合并 `main` 之后自动调用主机上的 `multica-build-and-reload.sh`：拉取最新 fork main → build `:dev` 镜像 → 把 `/opt/multica/.env` 切到 `:dev` → `systemctl reload multica-stack` → 探 `/readyz`。PostgreSQL / Redis 不会重启。

> **范围说明**：本 workflow 在 self-host 主机本地 build 镜像（不依赖 docker registry），等价于操作员手动跑 `bin/deploy.sh`，把"build + reload"两步合并。

---

## 流程

```
PR merge to main
   │
   ▼
GitHub Actions: .github/workflows/deploy-selfhost.yml
   │
   ▼ SSH (deploy@host, ed25519 key)
sudo /usr/local/bin/multica-build-and-reload.sh
   ├─ git fetch fork main && reset --hard fork/main
   ├─ docker compose build backend frontend          (5–10 min)
   ├─ backup .env, switch to multica-backend:dev / multica-web:dev
   ├─ sudo systemctl reload multica-stack
   └─ curl /readyz  (retry 30 × 2s)
```

`reload` vs `restart` 的差别详见根目录 `README.md §3.0`；本 workflow 选 `reload` 是因为它只动 backend/frontend，pgdata / backend_uploads 不会受影响。

---

## 1. 工作流做什么 / 不做什么

合并 `main` 后 CI 触发 `appleboy/ssh-action` 跑主机上的 `multica-build-and-reload.sh`，5 步：

1. `git fetch fork main && reset --hard fork/main` → 同步 fork main HEAD
2. `docker compose ... build backend frontend` → 真正 build `:dev` 镜像
3. 备份 `/opt/multica/.env` 并把镜像源切到 `multica-backend:dev` / `multica-web:dev` / `MULTICA_IMAGE_TAG=dev`
4. `systemctl reload multica-stack` → recreate 容器
5. `/readyz` 30 × 2s 探测

build 步骤是阻塞的（5–10 分钟），但 build 在 self-host 主机本地，CI runner 只做调度——不会有 docker-in-docker 的麻烦。文档/纯配置类的 PR 也照样 build，要避免就在那个 PR 加 `[skip build]` 标签或临时把 workflow 关掉。

只 reload 不 build 的旧路径仍保留：`multica-reload.sh` 同样在 sudoers 里，CI 临时想跳过 build 可以把 workflow 里 `multica-build-and-reload.sh` 换成 `multica-reload.sh`。

---

## 2. 一次性：主机侧准备

在 self-host 主机上以 `root` 执行（与 `README.md §3.0` 同主机）：

```bash
# 2.1 创建专用部署用户
adduser --disabled-password --gecos "GitHub Actions deployer" deploy

# 2.2 准备 .ssh 目录
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

# 2.3 生成专用 ed25519 密钥对（无口令；只在 CI 场景下使用）
sudo -u deploy ssh-keygen -t ed25519 -N '' \
  -C 'github-actions-deploy' \
  -f /home/deploy/.ssh/github_actions_ed25519

# 2.4 把公钥写进 authorized_keys（权限 600）
sudo -u deploy bash -c 'cat /home/deploy/.ssh/github_actions_ed25519.pub \
  >> /home/deploy/.ssh/authorized_keys'
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

接着写入受限 sudoers：

```bash
cat > /etc/sudoers.d/deploy <<'EOF'
Defaults:deploy !requiretty
Cmnd_Alias MULTICA_RELOAD = \
  /usr/bin/systemctl reload  multica-stack, \
  /usr/bin/systemctl status  multica-stack, \
  /usr/bin/systemctl is-active multica-stack, \
  /usr/local/bin/multica-reload.sh, \
  /usr/local/bin/multica-build-and-reload.sh
deploy ALL=(root) NOPASSWD: MULTICA_RELOAD
EOF
chmod 440 /etc/sudoers.d/deploy
visudo -c -f /etc/sudoers.d/deploy
```

> `!requiretty` 必须挂在**用户**上（`Defaults:deploy !requiretty`），不能挂在 `Cmnd_Alias` negation 上。`appleboy/ssh-action` 走 `request_pty=false` 的非交互式通道，只有用户级豁免才能让 sudo 接受。

`deploy` 用户**只能**：

- 无密码 `sudo systemctl reload / status / is-active multica-stack`。
- 无密码 `sudo /usr/local/bin/multica-reload.sh`（reload-only 包装）。
- 无密码 `sudo /usr/local/bin/multica-build-and-reload.sh`（build + reload 包装，CI 默认走这个）。
- 用自己的密钥 SSH 进自己。

没有 docker 组、没有 `restart`，也不能改任何 `systemctl` / 上述 wrapper 之外的命令。

可选的本地自测（在主机上以 root）：

```bash
sudo -u deploy sudo -n /usr/local/bin/multica-build-and-reload.sh
```

---

## 3. GitHub 仓库侧：配置 Secrets

仓库 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`：

| Secret 名 | 填入 | 说明 |
|---|---|---|
| `SSH_HOST` | `multica.cuinspace.com` 或主机公网 IP | GitHub Actions 远端的目标主机 |
| `SSH_PORT` | `22` | 自定义端口时改这里 |
| `SSH_USER` | `deploy` | 必须与主机侧创建的用户一致 |
| `SSH_KEY` | `/home/deploy/.ssh/github_actions_ed25519` 的**完整内容** | 包含 `-----BEGIN OPENSSH PRIVATE KEY-----` 头尾。粘贴前用 `cat` 复制，**不要**在多行框里少粘贴行 |

> 私钥文件路径：`/home/deploy/.ssh/github_actions_ed25519`。此文件等同于"主机对 GitHub Actions 的写权限密钥"，请只在 GitHub Secrets 留存，**不要**入库或同步到本地。公钥：`/home/deploy/.ssh/github_actions_ed25519.pub`。

> 如果你想让合并必须人工批准再部署，再去 `Settings → Environments → selfhost` 开启 "Required reviewers"。

---

## 4. 触发方式

任一条件触发：

- `git push` 到 `main`（含合并 PR）。
- 仓库 `Actions` 页选 `Deploy selfhost` → `Run workflow` 手动触发（用于联调）。

并发由 `concurrency.group: selfhost-deploy` 控制：同一时间只会有一个部署运行，新触发的会排队等待正在跑的完成。

---

## 5. 第一次联调建议步骤

1. **主机上自测 wrapper**（以 root）：

   ```bash
   sudo -u deploy sudo -n /usr/local/bin/multica-build-and-reload.sh
   /usr/bin/curl -sS https://api.cuinspace.com/readyz
   ```

   期望看到 `[1/5] … [5/5] Probing /readyz` + `readyz ok on attempt N`。

2. **GitHub 端**：在 `Actions` 选 `Deploy selfhost` → `Run workflow`，看是否变绿。第一次常见失败原因：私钥粘错（少末行）、`SSH_USER` 拼错、sudoers 漏了 `Defaults:deploy !requiretty`。

3. **联调成功后再走一次手动 `bin/deploy.sh`** 确认操作员路径和 CI 路径等价。

---

## 6. 回滚 / 紧急停用

- 停用自动部署：把 workflow 文件临时改名（例如加 `.disabled` 后缀）后 push，或在 GitHub 仓库 `Settings → Environments → selfhost` 取消部署保护并手动跳过。
- 镜像回滚：把 `/opt/multica/.env` 中 `MULTICA_IMAGE_TAG` 改回上一个 tag，然后 `systemctl reload multica-stack`。
- 真正紧急：登主机 `systemctl stop multica-stack`，回到上次已知好的镜像 + `.env` 组合。
- 临时只 reload 不 build：把 workflow 里 `multica-build-and-reload.sh` 换成 `multica-reload.sh`，下一次 merge 不会触发 build。

---

## 7. 路径速查

| 用途 | 路径 |
|---|---|
| Workflow | `/opt/multica/.github/workflows/deploy-selfhost.yml` |
| 本文 | `/opt/multica/docs/selfhost/deploy/github-actions.md` |
| 手动 deploy 脚本 | `/opt/multica/bin/deploy.sh` |
| Build + reload 包装脚本（CI 默认走这个） | `/usr/local/bin/multica-build-and-reload.sh` |
| Reload-only 包装脚本（保留备用） | `/usr/local/bin/multica-reload.sh` |
| 源码 checkout（CI 会 `reset --hard` 同步） | `/opt/multica-src` |
| systemd unit | `/etc/systemd/system/multica-stack.service` |
| 环境变量 | `/opt/multica/.env` |
| 部署用户 home | `/home/deploy` |
| 部署用户 SSH 私钥 | `/home/deploy/.ssh/github_actions_ed25519` |
| 部署用户 SSH 公钥 | `/home/deploy/.ssh/github_actions_ed25519.pub` |
| `authorized_keys` | `/home/deploy/.ssh/authorized_keys` |
| sudo 限权 | `/etc/sudoers.d/deploy` |
