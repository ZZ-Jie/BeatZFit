/**
 * Shared Aurora shader code — used by both threeScene.ts and AuroraBackground.vue.
 *
 * IMPORTANT: Both renderers must use identical GLSL to keep the Aurora background
 * visually consistent. Previously the shader was duplicated and had to be manually
 * kept in sync; this file is the single source of truth.
 */

export const AURORA_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const AURORA_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uMouse;
uniform float uBass;
uniform vec3 uAccent;
uniform vec2 uRes;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = uv;
  p.x *= uRes.x / uRes.y;
  vec2 m = uMouse;
  m.x *= uRes.x / uRes.y;

  float t = uTime * 0.045;

  vec2 q = vec2(fbm(p * 1.5 + t), fbm(p * 1.5 - t + 5.2));
  vec2 r = vec2(fbm(p * 1.5 + q * 2.0 + t * 1.3), fbm(p * 1.5 + q * 2.0 - t * 0.9 + 3.1));
  float f = fbm(p * 1.5 + r * 2.0);

  float band = smoothstep(0.18, 0.92, f);
  float curtain = sin((p.x + r.x * 1.6) * 3.0 + t * 2.0) * 0.5 + 0.5;

  vec3 base = mix(vec3(0.01, 0.01, 0.02), uAccent * 0.15, f);
  vec3 aur = mix(uAccent * 0.6, uAccent, curtain);
  vec3 col = base + aur * band * 0.55;

  float d = distance(p, m);
  col += uAccent * 0.12 * exp(-d * 2.6);
  col += uAccent * uBass * 0.28 * band;

  float vig = smoothstep(1.25, 0.2, distance(uv, vec2(0.5)));
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
`
