<script setup lang="ts">
import { computed } from 'vue'
/**
 * FrostedGlass
 *
 * 轻量级液态玻璃背景层 — 纯 CSS backdrop-filter 实现。
 * 通过 variant prop 支持 5 种层级，每层有独立的视觉参数。
 *
 * 层级体系：
 *   primary    → T1 主卡片（大面积内容容器）
 *   secondary  → T2 次级卡片（统计瓷片、子面板）
 *   floating   → T3 浮动层（弹窗、播放栏、侧边栏）
 *   interactive→ T4 交互控件（按钮、胶囊、滑块 — 玻璃质感最强）
 *   hint       → T5 信息提示（Toast、临时提示）
 *
 * ambientColor 色调吸收：
 *   传入 hex 色值后，组件自动生成 3 个不同透明度的 rgba 变量，
 *   分别用于底色叠加、边缘光晕、边框着色，模拟玻璃吸收环境光线。
 *
 * 性能：仅 1 个 DOM 元素 + 2 个伪元素，无 SVG 滤镜，无鼠标监听。
 */

type GlassVariant = 'primary' | 'secondary' | 'floating' | 'interactive' | 'hint'

interface Props {
  visible?: boolean
  cornerRadius?: number
  /** 环境色 — hex 格式，用于色调吸收（如 #E8A87C） */
  ambientColor?: string | null
  /** 玻璃层级，决定 blur/saturate/光泽/阴影强度 */
  variant?: GlassVariant
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  cornerRadius: 24,
  ambientColor: null,
  variant: 'primary',
})

/**
 * 将 hex 颜色转为指定透明度的 rgba 字符串。
 * 用于生成 ambientColor 的 3 个透明度变体。
 */
function hexToRgba(hex: string | null | undefined, alpha: number): string {
  if (!hex) return 'transparent'
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)
  if (isNaN(bigint)) return 'transparent'
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 计算环境色的 CSS 变量。
 * --fg-ambient-soft: 底色叠加层（15% 透明度）
 * --fg-ambient-glow: 边缘光晕层（8% 透明度）
 * --fg-ambient-rim:  边框着色层（20% 透明度）
 */
const ambientVars = computed(() => {
  const c = props.ambientColor
  return {
    '--fg-ambient-soft': hexToRgba(c, 0.15),
    '--fg-ambient-glow': hexToRgba(c, 0.08),
    '--fg-ambient-rim': hexToRgba(c, 0.20),
  } as Record<string, string>
})
</script>

<template>
  <div
    v-if="visible"
    class="frosted-glass"
    :class="`frosted-glass--${variant}`"
    :style="{
      borderRadius: `${cornerRadius}px`,
      ...ambientVars,
    }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
/* ===== 基础样式（所有层级共享） ===== */
.frosted-glass {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  -webkit-backdrop-filter: var(--fg-blur, blur(20px)) saturate(var(--fg-saturate, 150%));
  backdrop-filter: var(--fg-blur, blur(20px)) saturate(var(--fg-saturate, 150%));
  /* GPU 提升 + 布局隔离 */
  transform: translateZ(0);
  contain: layout paint;
  /* will-change 提示浏览器提前准备 backdrop-filter 计算，
     避免元素首次可见时模糊尚未渲染的两段闪烁。
     不使用 opacity 动画——Chromium 在 opacity:0 时会跳过 backdrop-filter 计算。 */
  will-change: backdrop-filter;
}

/* ===== T1 — 主卡片 (primary) ===== */
.frosted-glass--primary {
  --fg-blur: blur(24px);
  --fg-saturate: 160%;

  background:
    /* 顶部光泽 */
    linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, transparent 30%),
    /* 底部暗化 */
    linear-gradient(180deg, transparent 60%, rgba(0, 0, 0, 0.10) 100%),
    /* 环境色吸收 */
    radial-gradient(ellipse 120% 80% at 30% 20%, var(--fg-ambient-soft, transparent), transparent 60%),
    /* 基底 */
    rgba(255, 255, 255, 0.07);

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 0 0 1px rgba(255, 255, 255, 0.07),
    inset 0 -1px 0 rgba(0, 0, 0, 0.12),
    0 4px 24px rgba(0, 0, 0, 0.2);
}

/* ===== T2 — 次级卡片 (secondary) ===== */
.frosted-glass--secondary {
  --fg-blur: blur(18px);
  --fg-saturate: 150%;

  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, transparent 40%),
    radial-gradient(ellipse 100% 70% at 30% 20%, var(--fg-ambient-soft, transparent), transparent 55%),
    rgba(255, 255, 255, 0.05);

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    0 2px 12px rgba(0, 0, 0, 0.15);
}

/* ===== T3 — 浮动层 (floating) ===== */
.frosted-glass--floating {
  --fg-blur: blur(28px);
  --fg-saturate: 170%;

  background:
    /* 强顶部光泽 — 浮动层需要更明显的玻璃感 */
    linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, transparent 35%),
    /* 强底部暗化 */
    linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.14) 100%),
    /* 环境色吸收 — 浮动层吸收更强 */
    radial-gradient(ellipse 130% 90% at 30% 20%, var(--fg-ambient-soft, transparent), transparent 60%),
    /* 更不透明的基底 — 保证浮动层可读性 */
    rgba(255, 255, 255, 0.10);

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 -1px 0 rgba(0, 0, 0, 0.14),
    /* 边缘环境色光晕 */
    0 0 0 1px var(--fg-ambient-glow, transparent),
    0 8px 40px rgba(0, 0, 0, 0.3);
}

/* ===== T4 — 交互控件 (interactive) — 玻璃质感最强 ===== */
.frosted-glass--interactive {
  --fg-blur: blur(16px);
  --fg-saturate: 180%;

  background:
    /* 最强顶部光泽 — 交互控件需要最明显的玻璃质感 */
    linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, transparent 40%),
    /* 对角光泽 — 增强液态感 */
    linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, transparent 30%, transparent 70%, rgba(0, 0, 0, 0.04) 100%),
    /* 底部暗化 */
    linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.08) 100%),
    /* 环境色吸收 — 交互层吸收最强 */
    radial-gradient(ellipse 110% 80% at 35% 25%, var(--fg-ambient-soft, transparent), transparent 55%),
    /* 基底 — 更不透明以突出交互元素 */
    rgba(255, 255, 255, 0.07);

  box-shadow:
    /* 最强顶部高光 */
    inset 0 1px 0 0.5px rgba(255, 255, 255, 0.20),
    /* 内边框 — 环境色着色 */
    inset 0 0 0 1px var(--fg-ambient-rim, rgba(255, 255, 255, 0.08)),
    /* 底部暗边 */
    inset 0 -1px 0 rgba(0, 0, 0, 0.10),
    /* 边缘环境色光晕 — 交互层最强 */
    0 0 0 1px var(--fg-ambient-glow, transparent),
    0 0 12px var(--fg-ambient-glow, transparent),
    /* 外阴影 */
    0 2px 12px rgba(0, 0, 0, 0.18);
}

/* ===== T5 — 信息提示 (hint) ===== */
.frosted-glass--hint {
  --fg-blur: blur(14px);
  --fg-saturate: 140%;

  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, transparent 40%),
    rgba(255, 255, 255, 0.09);

  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    0 4px 16px rgba(0, 0, 0, 0.2);
}
</style>
