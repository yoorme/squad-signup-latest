# 极光推送（JPush）接入指南

接入厂商推送通道后，App **完全不需要在后台运行**也能即时收到通知（新比赛 / 比赛临近提醒 / 新公告）。
未接入期间，App 自带 WorkManager 轮询兜底（最短 15 分钟检查一次），功能不受影响，只是送达可能有延迟。

## 一、注册极光并创建应用（约 10 分钟，需你本人完成）

1. 打开 [极光官网](https://www.jiguang.cn/) 注册开发者账号（个人即可，需实名认证）。
2. 控制台 →「创建应用」：
   - 应用名称：随意（如「战队报名」）
   - 应用图标：随意
   - **Android**：包名填 `com.yoorme.squadsignup`（必须与 App 一致）
3. 创建完成后，在应用详情页「应用信息」里拿到两串值：
   - **AppKey**
   - **Master Secret**（点「查看」获取）

> 一个极光应用即可同时服务 MMR / YFD 两个战队站点（设备绑定各自站点的账号，互不干扰）。

## 二、服务端配置（我来做或照此执行）

在服务器上为两个实例的 `.env` 追加极光配置并重启服务：

```bash
# /opt/squad-signup/.env（MMR）与 /opt/squad-signup/instances/shuishangyue/.env（YFD）
JPUSH_APPKEY='你的AppKey'
JPUSH_MASTER_SECRET='你的MasterSecret'

systemctl restart squad-signup squad-signup-shuishangyue
```

服务端已内置：
- `lib/push.ts` 极光 REST 客户端（分批发送、失败降级、未配置时静默跳过）
- 创建赛事 → 推送「新比赛发布」
- 发布公告 → 推送「新公告」
- systemd timer 每分钟扫描「已报名比赛临近」并按每人设置的提前量推送（PushLog 去重，不重发）

## 三、App 端集成

App 代码已预留接入点（`SquadApp.onCreate` 中的 `PushManager.init`）：

1. 在极光控制台下载 Android SDK（或使用极光私有 Maven）。
2. `app/build.gradle.kts` 添加极光依赖，并在 `AndroidManifest.xml` 中配置 AppKey 元数据。
3. 在 `SquadApp.onCreate()` 调用 `JPushInterface.setDebugMode(false)` + `JPushInterface.init(this)`。
4. App 登录后调用 `POST /api/me/devices` 上报极光 `registration_id`（接口已就绪），
   退出登录时调用 DELETE 解绑——把这两处接上极光的 `JPushInterface.getRegistrationID(context)` 即可。

完成上述步骤后，通知链路为：

```
管理员创建比赛 ──→ 服务端 JPush REST ──→ 极光服务器 ──→ 各手机厂商通道 ──→ 队员收到系统通知
```

## 四、验证

1. 极光控制台 → 应用 →「推送测试」：填入设备的 registration_id 发一条测试通知。
2. 手机收到即说明厂商通道可用。
3. 在网站上创建一场几分钟后的比赛，确认报名者手机能在预期时间收到提醒。
