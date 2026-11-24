import { iconDataUri, languageInput, type BarManifest } from "./src/build/manifest.ts";
import { ICON_BODIES } from "./src/ui/icons.ts";

const manifest: BarManifest = {
  id: "beszel",
  title: "Beszel",
  version: "0.2.0",
  minAppVersion: "0.3.0",
  description: "Monitor your self-hosted Beszel servers, containers, and alerts.",
  locales: {
    "zh-Hans": {
      title: "Beszel",
      description: "监控自建 Beszel 主机、容器与告警。",
    },
  },
  icon: iconDataUri(ICON_BODIES.server, "currentColor"),
  category: "monitor",
  refresh: "1m",
  material: "solid",
  openMode: "flyout",
  windowStyle: "standard",
  widget: true,
  notch: true,
  homepage: "https://github.com/miantiao-me/beszel.bar",
  license: "Apache-2.0",
  permissions: {
    network: [{ origin: "{{ inputs.server }}", fromUrl: true, allowHttp: true }],
    inbox: "manage",
  },
  inputs: [
    languageInput,
    {
      name: "server",
      type: "string",
      label: "Server URL",
      default: "http://127.0.0.1:8090",
      placeholder: "https://beszel.example.com",
      help: "Your Beszel URL. Local HTTP is supported.",
      required: true,
      zh: {
        label: "服务器地址",
        help: "Beszel 地址，支持内网 HTTP。",
      },
    },
    {
      name: "email",
      type: "secret",
      label: "Email",
      help: "Account email. A read-only user is recommended.",
      required: true,
      zh: { label: "邮箱", help: "登录邮箱，建议使用只读账号。" },
    },
    {
      name: "password",
      type: "secret",
      label: "Password",
      required: true,
      zh: { label: "密码" },
    },
    {
      name: "refreshInterval",
      type: "select",
      label: "Refresh Interval",
      default: "30",
      help: "How often to refresh data.",
      zh: { label: "刷新间隔", help: "数据刷新频率。" },
      options: [
        { value: "15", label: "15s", zh: "15 秒" },
        { value: "30", label: "30s", zh: "30 秒" },
        { value: "60", label: "60s", zh: "60 秒" },
      ],
    },
    {
      name: "trayFormat",
      type: "select",
      label: "Menu Bar",
      default: "online",
      help: "What to show in the menu bar.",
      zh: {
        label: "菜单栏显示",
        help: "菜单栏显示的内容。",
      },
      options: [
        { value: "online", label: "Online (4/5)", zh: "在线数 (4/5)" },
        { value: "online_rate", label: "Online + Bandwidth", zh: "在线数与带宽" },
        { value: "cpu", label: "Average CPU", zh: "平均 CPU" },
        { value: "rate_spark", label: "Bandwidth Sparkline (macOS)", zh: "带宽迷你图 (macOS)" },
        { value: "cpu_spark", label: "CPU Sparkline (macOS)", zh: "CPU 迷你图 (macOS)" },
      ],
    },
    {
      name: "notchMetric",
      type: "select",
      label: "Notch Metric",
      default: "online",
      help: "Metric shown in the screen notch (Plus).",
      zh: { label: "刘海屏指标", help: "刘海屏显示的数值（Plus）。" },
      options: [
        { value: "online", label: "Online (4/5)", zh: "在线数 (4/5)" },
        { value: "cpu", label: "Average CPU (48%)", zh: "平均 CPU (48%)" },
        { value: "rate", label: "Bandwidth (14.6M)", zh: "实时带宽 (14.6M)" },
      ],
    },
    {
      name: "widgetMode",
      type: "select",
      label: "Desktop Widget",
      default: "overview",
      help: "What desktop widgets display.",
      zh: { label: "桌面小组件", help: "桌面小组件显示的内容。" },
      options: [
        { value: "overview", label: "Overview", zh: "集群总览" },
        { value: "system", label: "Single Server", zh: "单台主机" },
        { value: "alerts", label: "Alerts", zh: "告警" },
      ],
    },
    {
      name: "widgetSystem",
      type: "string",
      label: "Widget Server",
      help: "Single Server widget only. Leave blank to follow the selected server.",
      zh: {
        label: "小组件主机",
        help: "仅单台主机小组件生效，留空跟随当前选中主机。",
      },
    },
    {
      name: "notify",
      type: "bool",
      label: "Notifications",
      default: false,
      help: "Notify on outages, high load, or new alert messages.",
      zh: {
        label: "桌面通知",
        help: "主机离线、超阈或收到告警消息时提醒。",
      },
    },
    {
      name: "threshold",
      type: "integer",
      label: "Alert Threshold %",
      default: 90,
      help: "Alert when CPU, memory, or disk reaches this value (0 to disable).",
      zh: { label: "告警阈值 %", help: "资源达到该百分比时提醒，0 为关闭。" },
    },
  ],
  apis: ["intl", "shell", "localStorage", "notification", "clipboard", "match-media"],
  docs: `Monitor your self-hosted Beszel servers in read-only mode.

Quick Start
1. Enter your Beszel URL (e.g. https://beszel.example.com or http://10.0.0.2:8090).
2. Enter your email and password (a read-only account is recommended).

Optional: Alert Messages (Metrix.Bar Plus)
1. Create an Inbox in Metrix.Bar and bind it to this dashboard with manage access.
2. In Beszel Settings > Notifications, add a Webhook using your Inbox URL with the generic:// scheme:
   generic://agili-inbox.com/h/<inbox-id>/<secret>
   (Append ?template=json if preferred, or send to <inbox-id>@agili-inbox.com if SMTP is configured.)`,
  docsLocales: {
    "zh-Hans": `以只读方式监控自建 Beszel 主机、容器与告警。

快速开始
1. 填写 Beszel 地址（如 https://beszel.example.com 或内网 http://10.0.0.2:8090）。
2. 填写登录邮箱与密码（建议使用只读账号）。

可选：接收告警推送（Metrix.Bar Plus）
1. 在 Metrix.Bar 中创建收件箱并绑定到此看板（开启管理权限以便删除消息）。
2. 在 Beszel「设置 → 通知」中添加 Webhook，将收件箱 Webhook 地址的 https:// 改为 generic://：
   generic://agili-inbox.com/h/<inbox-id>/<secret>
   （如需 JSON 格式可追加 ?template=json；如已配置 SMTP 也可直接填 <inbox-id>@agili-inbox.com。）`,
  },
};

export default manifest;
