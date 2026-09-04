# 登录后刷新页面掉登录态排查记录

## 1. 问题现象

用户登录成功后，刷新（F5）页面会重新回到 `/login`，尤其是**连续快速刷新**时更容易复现。

## 2. 登录态实现回顾

- Access Token：JWT，2h 有效期，只存在前端内存（Zustand `useAuthStore`），不落 `localStorage`，不持久化。
- Refresh Token：JWT，7d 有效期，通过 `HttpOnly + SameSite=Strict` Cookie 下发，浏览器自动带上，JS 读不到。
- 页面刷新后前端内存态清空，靠 `App.tsx` 启动时调用 `bootstrapAuth()`：用 Cookie 里的 Refresh Token 换新的 Access Token，再拉 `/users/me` 恢复 `user`，成功后 `RequireAuth` 才放行，否则跳 `/login`。
- 后端 `POST /auth/refresh` 采用**一次性轮换（rotate-and-revoke）**策略：每次调用会把旧 Refresh Token 标记 `revokedAt`，同时签发一对新的 Access/Refresh Token（见 `apps/api/src/auth/auth.service.ts` `refresh()` / `issueTokenPair()`）。

## 3. 第一处根因：StrictMode 导致 effect 双调用（已修复）

`apps/web/src/main.tsx` 用了 `<StrictMode>`。React 18 在开发模式下，会对每个组件的挂载**自动模拟一次"卸载再挂载"**（mount → unmount → mount），用来暴露非幂等的副作用，因此 `App.tsx` 里：

```tsx
useEffect(() => {
  void bootstrapAuth();
}, []);
```

这个 effect 在 dev 环境下实际会被调用两次，导致刷新页面时**几乎同时**发出两个 `POST /auth/refresh` 请求，且都带着同一个（旧的）Refresh Token Cookie。

由于后端是一次性轮换：第一个请求处理完会把这个 token 标记为 `revokedAt` 并下发新 Cookie；第二个请求几乎同时到达，仍带着同一个旧 token，一查 DB 发现已经 `revokedAt` 为真，直接判定为"登录已过期"，前端 `catch` 分支 `clear()` 掉登录态，跳回 `/login`。

### 已落地的修复

`apps/web/src/lib/auth-api.ts`：给 `bootstrapAuth` 加了模块级 Promise 去重（与 `api-client.ts` 里 `refreshAccessToken` 的去重方式一致），保证**同一时间内的重复调用只真正发出一次请求**，其余调用方复用同一个 Promise：

```ts
let bootstrapPromise: Promise<void> | null = null;
export function bootstrapAuth(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = doBootstrapAuth().finally(() => {
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}
```

这个修复解决了"同一次页面挂载内，JS 层面重复触发"的场景（StrictMode 双调用、多组件同时挂载等）。

## 4. 第二处根因：物理刷新中断请求，响应丢失（未修复，需要后端方案）

即便修好了上面的并发问题，**连续快速手动刷新页面**仍会复现掉登录态，原因跟并发无关，而是"一次性轮换"策略本身的脆弱点：

1. 用户按 F5，浏览器发出 `POST /auth/refresh`（带 Cookie，值为 C0）。
2. **请求到达服务端并处理完成**：C0 被标记 `revokedAt`，生成新的 C1，响应头带 `Set-Cookie: C1`。
3. 但在服务端处理、响应尚未传回浏览器的这个时间窗口内，用户又按了一次 F5——**当前页面被整个销毁重建，飞行中的请求被中断，响应里的 `Set-Cookie: C1` 根本没机会被浏览器应用**。
4. 新页面加载后再次发起 `/auth/refresh`，浏览器手里还是旧的 C0——但 C0 在服务端已经是 `revokedAt` 状态。
5. 服务端校验 `record.revokedAt` 为真 → 抛 `UnauthorizedException('登录已过期，请重新登录')` → 前端清空登录态 → 跳转 `/login`。

**结论**：只要出现"请求已被服务端消费，但响应未能安全落地到浏览器"（连续刷新中断请求、弱网丢包等），当前的一次性轮换策略就会把这次正常操作误判为登录过期。这是策略设计层面的问题，前端无法单独规避。

## 5. 根本解决方案：Refresh Token 轮换加宽限期（Grace Period）/ 幂等重放容错

参考 OAuth2 Refresh Token Rotation 的通用容错做法：**旧 token 被使用后不立即彻底失效，而是保留一个短暂宽限期**（例如 10~30 秒）。宽限期内如果又用同一个旧 token 发起 refresh，不视为异常，而是**幂等地返回上一次生成的那一对新 token**，不重新轮换。

### 相较现状的行为差异

| 场景 | 当前行为 | 宽限期方案行为 |
|---|---|---|
| 正常单次 refresh | 轮换成功 | 不变 |
| 宽限期内重复用旧 token（响应丢失导致） | 判定过期，强制登出 | 返回同一对新 token，登录态保留 |
| 超出宽限期后重放旧 token（疑似被盗用/重放攻击） | 判定过期 | 判定过期，可选择吊销整条 token 链 |

### 需要的改动（尚未实施，需单独排期）

1. **DB Schema**（`apps/api/prisma/schema.prisma` `RefreshToken` 模型）：现有字段 `id / userId / tokenHash / expiresAt / revokedAt / createdAt` 不足以支持"查到旧 token 被替换成了哪一个新 token"，需要新增类似 `replacedByTokenHash String?` 的字段记录轮换链路，并配套一次 `prisma migrate`。
2. **`AuthService.refresh()` 逻辑改造**：
   - token 有效（未 revoke）→ 走现有轮换逻辑，记录 `replacedByTokenHash`。
   - token 已 revoke，但 `revokedAt` 在宽限期内，且能通过 `replacedByTokenHash` 查到对应的新 token 仍有效 → 不报错，重新签发/返回与那次轮换等价的新 Access Token（可选择是否重用同一个 Refresh Token 还是重新签一个短期等价的）。
   - token 已 revoke 且超出宽限期 → 保持现状，判定登录过期，可选加上"检测到重放，吊销该用户全部 Refresh Token"的安全响应。
3. **测试**：需要覆盖"正常轮换"、"宽限期内重放"、"超期后重放"三种场景的单测。

### 风险与工作量

涉及数据库字段变更、迁移脚本、核心鉴权逻辑改造，属于安全敏感代码，改动量和测试成本明显高于前端去重方案，需要单独排期评审，不建议随手改。

## 6. 当前状态

- [x] 前端并发去重（`bootstrapAuth` Promise 复用）已完成并落地。
- [ ] 后端 Refresh Token 宽限期/幂等容错方案：**待评审排期，尚未实施**。
