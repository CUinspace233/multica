# GitHub Actions → self-host 自动部署

合并 `main` 之后自动调用 `systemctl reload multica-stack`，让 backend / frontend 容器用最新的 `.env` 与镜像重建。PostgreSQL / Redis 不会重启。

> **范围说明**：本 workflow 不构建镜像，也不修改 `/opt/multica` 工作区。假设 `:dev` 镜像已经构建完成并写入了 `/opt/multica/.env`（一般是先在主机上跑一次 `bin/deploy.sh` 把镜像切到 `:dev`）。本流程只把"触发 reload"这一步自动化。

---

## 流程

```
PR merge to main
   │
   ▼
GitHub Actions: .github/workflows/deploy-selfhost.yml
   │
   ▼ SSH (deploy@host, ed25519 key)
sudo systemctl reload multica-stack        # 重读 .env，recreate backend + frontend
sudo systemctl is-active  multica-stack   # 确认 systemd 视角的活跃
curl https://api.cuinspace.com/readyz      # 确认 API 报 {"db":"ok","migrations":"ok"}
```

`reload` vs `restart` 的差别详见根目录 `README.md §3.0`；本 workflow 选 `reload` 是因为它只动 backend/frontend，pgdata / backend_uploads 不会受影响。

---

## 1. 一次性：主机侧准备

在 self-host 主机上以 `root` 执行（与 `README.md §3.0` 同主机）：

```bash
# 1.1 创建专用部署用户
adduser --disabled-password --gecos "GitHub Actions deployer" deploy

# 1.2 准备 .ssh 目录
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

# 1.3 生成专用 ed25519 密钥对（无口令；只在 CI 场景下使用）
sudo -u deploy ssh-keygen -t ed25519 -N '' \
  -C 'github-actions-deploy' \
  -f /home/deploy/.ssh/github_actions_ed25519

# 1.4 把公钥写进 authorized_keys（权限 600）
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
  /usr/bin/systemctl is-active multica-stack
deploy ALL=(root) NOPASSWD: MULTICA_RELOAD
EOF
chmod 440 /etc/sudoers.d/deploy
visudo -c -f /etc/sudoers.d/deploy
```

> `!requiretty` 必须挂在**用户**上（`Defaults:deploy !requiretty`），不能挂在 `Cmnd_Alias` negation 上。`appleboy/ssh-action` 走 `request_pty=false` 的非交互式通道，只有用户级豁免才能让 sudo 接受。

`deploy` 用户**只能**：

- 无密码 `sudo systemctl reload / status / is-active multica-stack`。
- 用自己的密钥 SSH 进自己。

没有 docker 组、没有 `restart`，也不能改任何 `systemctl` 之外的命令。

可选的本地自测（在主机上以 root）：

```bash
sudo -u deploy sudo -n /usr/bin/systemctl reload multica-stack
sudo -u deploy sudo -n /usr/bin/systemctl is-active multica-stack
```

---

## 2. GitHub 仓库侧：配置 Secrets

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

## 3. 触发方式

任一条件触发：

- `git push` 到 `main`（含合并 PR）。
- 仓库 `Actions` 页选 `Deploy selfhost` → `Run workflow` 手动触发（用于联调）。

并发由 `concurrency.group: selfhost-deploy` 控制：同一时间只会有一个部署运行，新触发的会排队等待正在跑的完成。

---

## 4. 第一次联调建议步骤

1. **先手工跑一遍** `bin/deploy.sh`，确保主机上 `:dev` 镜像和 `.env` 就位、`multica-stack` active：

   ```bash
   /opt/multica/bin/deploy.sh
   /usr/bin/curl -sS https://api.cuinspace.com/readyz
   ```

2. **本地模拟 workflow**（以 root 在主机上）：

   ```bash
   sudo -u deploy sudo -n /usr/bin/systemctl reload multica-stack
   /usr/bin/curl -sS https://api.cuinspace.com/readyz
   ```

   都应成功。

3. **GitHub 端**：在 `Actions` 选 `Deploy selfhost` → `Run workflow`，看是否变绿。第一次常见失败原因：私钥粘错（少末行）、`SSH_USER` 拼错、sudoers 漏了 `Defaults! ... !requiretty`。

---

## 5. 回滚 / 紧急停用

- 停用自动部署：把 workflow 文件临时改名（例如加 `.disabled` 后缀）后 push，或在 GitHub 仓库 `Settings → Environments → selfhost` 取消部署保护并手动跳过。
- 镜像回滚：把 `/opt/multica/.env` 中 `MULTICA_IMAGE_TAG` 改回上一个 tag，然后 `systemctl reload multica-stack`。
- 真正紧急：登主机 `systemctl stop multica-stack`，回到上次已知好的镜像 + `.env` 组合。

---

## 6. 路径速查

| 用途 | 路径 |
|---|---|
| Workflow | `/opt/multica/.github/workflows/deploy-selfhost.yml` |
| 本文 | `/opt/multica/docs/selfhost/deploy/github-actions.md` |
| 手动 deploy 脚本 | `/opt/multica/bin/deploy.sh` |
| systemd unit | `/etc/systemd/system/multica-stack.service` |
| 环境变量 | `/opt/multica/.env` |
| 部署用户 home | `/home/deploy` |
| 部署用户 SSH 私钥 | `/home/deploy/.ssh/github_actions_ed25519` |
| 部署用户 SSH 公钥 | `/home/deploy/.ssh/github_actions_ed25519.pub` |
| `authorized_keys` | `/home/deploy/.ssh/authorized_keys` |
| sudo 限权 | `/etc/sudoers.d/deploy` |
