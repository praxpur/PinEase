<script setup lang="ts">
withDefaults(defineProps<{ bad?: boolean; compact?: boolean; view?: 'front' | 'side' }>(), { bad: false, compact: false, view: 'side' })
</script>

<template>
  <svg viewBox="0 0 520 360" fill="none" class="posture-illustration" role="img" :aria-label="(view === 'front' ? '正面' : '侧面') + (bad ? '低头坐姿示意' : '舒适坐姿示意')">
    <rect x="32" y="30" width="456" height="296" rx="22" fill="var(--illustration-paper, #eeeae0)" />
    <ellipse cx="258" cy="302" rx="153" ry="8" fill="var(--illustration-floor, #d5d6ca)" opacity=".55" />
    <path d="M74 299H446" stroke="var(--illustration-line, #899688)" stroke-width="1.5" opacity=".45" />
    <g v-if="view === 'front'">
      <ellipse cx="260" cy="157" rx="101" ry="107" fill="var(--illustration-screen, #e4e4da)" opacity=".65" />
      <rect x="207" y="137" width="106" height="101" rx="17" fill="var(--illustration-screen, #e4e4da)" stroke="var(--illustration-line, #899688)" stroke-width="2" />
      <path d="M201 191V238H319V191M215 239L206 297M305 239L314 297" stroke="var(--illustration-line, #899688)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="197" y="230" width="126" height="11" rx="5.5" fill="var(--illustration-line, #899688)" />
      <g class="illustration-person">
        <path d="M229 209Q260 216 291 209L298 239Q294 256 291 286H273L268 246H252L247 286H229Q226 259 222 240Z" fill="#70786c" />
        <path d="M260 224V245M235 240L238 276M285 240L282 276" stroke="#596454" stroke-width="2" stroke-linecap="round" opacity=".65" />
        <path d="M229 284H248L250 295Q246 299 226 298L221 295Z" fill="#3c4b40" />
        <path d="M272 284H291L299 295L295 298Q275 299 270 295Z" fill="#3c4b40" />
        <path d="M226 296H248M273 296H295" stroke="#b0b8a4" stroke-width="2" stroke-linecap="round" />
        <path :d="bad ? 'M239 132Q224 135 215 148L225 184L228 213Q260 224 292 213L295 184L305 148Q294 135 281 132Z' : 'M241 125Q224 128 213 140L225 177L228 212Q260 221 292 212L295 177L307 140Q295 128 279 125Z'" fill="#56755c" />
        <path :d="bad ? 'M214 148Q205 165 202 187L219 193L233 166' : 'M214 140Q203 157 200 181L217 188L232 157'" fill="#6e8b72" />
        <path :d="bad ? 'M306 148Q315 165 318 187L301 193L287 166' : 'M306 140Q317 157 320 181L303 188L288 157'" fill="#6e8b72" />
        <path :d="bad ? 'M208 188L216 209L239 222' : 'M207 182L214 205L237 220'" stroke="#cfae92" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
        <path :d="bad ? 'M312 188L304 209L281 222' : 'M313 182L306 205L283 220'" stroke="#cfae92" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M230 218L241 223M290 218L279 223" stroke="#dec2a9" stroke-width="9" stroke-linecap="round" />
        <path :d="bad ? 'M229 178L233 207M291 178L287 207M245 202Q260 206 275 202' : 'M229 172L233 205M291 172L287 205M245 200Q260 204 275 200'" stroke="#3e6047" stroke-width="1.7" stroke-linecap="round" opacity=".6" />
        <path :d="bad ? 'M250 115V137Q260 147 270 137V115' : 'M250 107V130Q260 140 270 130V107'" fill="#cfae92" />
        <path :d="bad ? 'M243 135Q260 151 277 135' : 'M243 127Q260 143 277 127'" stroke="#3e6047" stroke-width="3" stroke-linecap="round" />
        <g :transform="bad ? 'translate(0 11)' : undefined">
          <ellipse cx="240" cy="91" rx="4" ry="7" fill="#cfae92" />
          <ellipse cx="280" cy="91" rx="4" ry="7" fill="#cfae92" />
          <path :d="bad ? 'M240 80Q240 65 260 65Q280 65 280 80V96Q279 114 260 119Q241 114 240 96Z' : 'M240 77Q240 62 260 62Q280 62 280 77V94Q279 113 260 118Q241 113 240 94Z'" fill="#dec2a9" />
          <path d="M239 87L237 76Q237 57 257 56Q281 53 284 75L281 89L276 78Q261 81 252 70Q248 80 242 81L242 91Z" fill="#4b554b" />
          <path d="M247 88H253M267 88H273" stroke="#6d675b" stroke-width="1.6" stroke-linecap="round" />
          <g v-if="!bad" fill="#4b554b"><ellipse cx="250" cy="92" rx="1.4" ry="1.8" /><ellipse cx="270" cy="92" rx="1.4" ry="1.8" /></g>
          <path v-else d="M248 96L253 97M267 97L272 96" stroke="#4b554b" stroke-width="1.6" stroke-linecap="round" />
          <path d="M260 93L258 101H261M255 108Q260 110 265 108" stroke="#b28c74" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </g>
      <path d="M175 100V86H189M331 86H345V100M175 211V225H189M331 225H345V211" stroke="var(--illustration-line, #899688)" stroke-width="2" stroke-linecap="round" opacity=".5" />
      <path d="M393 291V253M393 273Q374 270 374 255Q391 255 393 273M393 264Q410 260 410 246Q393 248 393 264" stroke="#8b9a7d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M382 279H404L400 298H386Z" fill="var(--illustration-line, #899688)" opacity=".7" />
    </g>
    <g v-else>
      <ellipse cx="225" cy="157" rx="91" ry="107" fill="var(--illustration-screen, #e4e4da)" opacity=".65" />
      <path d="M193 149L189 217Q188 231 204 231H266M207 235L198 297M258 235L269 297" stroke="var(--illustration-line, #899688)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M192 150L188 209" stroke="var(--illustration-line, #899688)" stroke-width="12" stroke-linecap="round" />
      <rect x="194" y="226" width="78" height="10" rx="5" fill="var(--illustration-line, #899688)" />
      <path d="M223 218L277 231L279 285" stroke="#899082" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M271 284H285L302 295Q303 299 296 299H271Z" fill="#536052" />
      <path :d="bad ? 'M237 150L250 177L283 185' : 'M219 146L232 176L278 183'" stroke="#b69880" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" />
      <g class="illustration-person">
        <path d="M215 207Q234 212 256 213L286 217Q302 219 303 234L305 283H286L276 242L229 241Q212 235 210 221Z" fill="#70786c" />
        <path d="M234 228L283 231L294 277" stroke="#596454" stroke-width="1.8" stroke-linecap="round" opacity=".65" />
        <path d="M286 283H304L310 289L328 294Q332 299 324 300H284L281 296Z" fill="#3c4b40" />
        <path d="M286 297H325" stroke="#b0b8a4" stroke-width="2" stroke-linecap="round" />
        <path :d="bad ? 'M231 126Q246 122 256 139L263 173Q256 190 248 216L215 212Q211 191 214 176Q213 145 231 126Z' : 'M219 126Q234 122 244 136L250 169Q246 192 247 215L214 212Q207 189 211 171Q208 142 219 126Z'" fill="#56755c" />
        <path :d="bad ? 'M216 180Q219 194 220 207M244 192L239 207' : 'M214 174Q217 188 217 204M240 188L238 205'" stroke="#3e6047" stroke-width="1.7" stroke-linecap="round" opacity=".6" />
        <path :d="bad ? 'M239 128L251 111L263 118L251 139' : 'M221 131L222 107L235 107L237 132'" fill="#cfae92" />
        <path :d="bad ? 'M238 133Q242 142 253 140' : 'M219 130Q226 138 237 133'" stroke="#3e6047" stroke-width="2.5" stroke-linecap="round" />
        <g :transform="bad ? 'translate(21 10) rotate(19 229 96)' : undefined">
          <path d="M213 76Q213 60 231 61Q246 63 247 79L249 86L254 92Q255 95 249 96L248 104Q245 114 232 115L220 106L215 94Z" fill="#dec2a9" />
          <path d="M214 94Q205 82 209 71Q211 56 228 56Q247 57 249 72L247 82Q240 81 235 72L230 83L223 85L222 96Z" fill="#4b554b" />
          <ellipse cx="224" cy="91" rx="4.5" ry="6" fill="#d4b396" />
          <path d="M223 89Q226 87 227 91M240 84L245 85M246 101L250 100" stroke="#987d68" stroke-width="1.3" stroke-linecap="round" />
          <circle cx="242" cy="89" r="1.5" fill="#4b554b" />
        </g>
        <path :d="bad ? 'M247 143L258 171L246 178L233 153Q229 140 239 138Q244 137 247 143Z' : 'M238 139L251 164L239 172L225 149Q221 138 229 134Q234 132 238 139Z'" fill="#6e8b72" />
        <path :d="bad ? 'M252 173L263 184L301 186' : 'M245 167L255 182L301 184'" stroke="#cfae92" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M299 184L312 185L318 188H303" stroke="#dec2a9" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
      </g>
      <rect x="288" y="192" width="153" height="7" rx="3.5" fill="var(--illustration-line, #899688)" />
      <path d="M302 200L298 297M427 200L433 297" stroke="var(--illustration-line, #899688)" stroke-width="4" stroke-linecap="round" />
      <rect x="339" y="91" width="76" height="62" rx="5" fill="var(--illustration-screen, #e4e4da)" stroke="var(--illustration-line, #899688)" stroke-width="2.5" />
      <path d="M346 101H408V143H346Z" fill="var(--illustration-paper, #eeeae0)" opacity=".8" />
      <path d="M377 154V189M363 190H391M300 190H342" stroke="var(--illustration-line, #899688)" stroke-width="3" stroke-linecap="round" />
      <path d="M355 113H391M355 121H399M355 129H383" stroke="var(--illustration-line, #899688)" stroke-width="2" stroke-linecap="round" opacity=".4" />
      <path d="M133 93V226M128 93H138M128 226H138" stroke="var(--illustration-line, #899688)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 6" opacity=".45" />
    </g>
  </svg>
</template>
