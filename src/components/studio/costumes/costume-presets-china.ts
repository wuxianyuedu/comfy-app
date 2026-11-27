/**
 * 服饰库 · 中式（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 * 用词沿用 `workshop/character-options.ts` 的受控词表，不另造称谓。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const costumePresetsChina: ReadonlyArray<ResearchPreset> = [
  {
    description: "汉代曲裾深衣，交领右衽绕襟，衣摆螺旋包裹，典雅庄重",
    id: "han-quju-shenyi",
    local: true,
    name: "曲裾深衣",
    prompt:
      "Han dynasty quju shenyi, cross collar wrapping diagonally, layered silk robe, spiraling hem, wide sleeves, elegant and solemn, historical Chinese costume",
    tags: ["中式", "汉服", "汉代", "交领", "深衣", "礼服"],
  },
  {
    description: "汉代直裾深衣，衣襟垂直下垂，素色绢帛，简洁大方",
    id: "han-zhiju-shenyi",
    local: true,
    name: "直裾深衣",
    prompt:
      "Han dynasty zhiju shenyi, straight hanging hem, cross collar, plain silk fabric, wide sleeves, clean silhouette, restrained elegance, historical Chinese costume",
    tags: ["中式", "汉服", "汉代", "直裾", "素雅"],
  },
  {
    description: "唐制齐胸襦裙，高腰束于胸上，飘带长裙，粉绿配色，少女感",
    id: "tang-qixiong-ruqun",
    local: true,
    name: "齐胸襦裙",
    prompt:
      "Tang dynasty qixiong ruqun, high-waisted skirt tied above the bust, long flowing ribbons, pastel pink and mint green, layered translucent sleeves, youthful and graceful",
    tags: ["中式", "汉服", "唐代", "齐胸", "襦裙", "少女"],
  },
  {
    description: "齐腰襦裙，短襦配高腰长裙，日常穿着，清新轻盈",
    id: "han-qiyao-ruqun",
    local: true,
    name: "齐腰襦裙",
    prompt:
      "traditional Chinese qiyao ruqun, short jacket with natural-waist long skirt, light cotton fabric, fresh spring colors, simple daily wear, soft drape",
    tags: ["中式", "汉服", "齐腰", "襦裙", "日常"],
  },
  {
    description: "明制袄裙，立领对襟袄配马面裙，端庄温婉",
    id: "ming-aoqun",
    local: true,
    name: "袄裙",
    prompt:
      "Ming dynasty aoqun, stand collar jacket with front closure, matching mamian skirt, embroidered details, dignified gentle silhouette, traditional Chinese formal wear",
    tags: ["中式", "汉服", "明代", "袄裙", "立领", "端庄"],
  },
  {
    description: "马面裙，前后光面两侧褶裥，织金纹样，行走时褶裥流转",
    id: "ming-mamianqun",
    local: true,
    name: "马面裙",
    prompt:
      "Ming dynasty mamianqun horse-face skirt, smooth front and back panels with side pleats, gold woven patterns, flowing pleats when walking, rich red and gold, elegant",
    tags: ["中式", "汉服", "明代", "马面裙", "织金", "褶裥"],
  },
  {
    description: "唐制圆领袍，窄袖圆领，官服式样，英气中性",
    id: "tang-yuanlingpao",
    local: true,
    name: "圆领袍",
    prompt:
      "Tang dynasty yuanlingpao round-collar robe, narrow sleeves, official attire style, dark crimson silk, leather belt, handsome androgynous look, historical Chinese costume",
    tags: ["中式", "汉服", "唐代", "圆领袍", "官服", "中性"],
  },
  {
    description: "宋制褙子，直领对襟两侧开衩，淡雅素净，文人气质",
    id: "song-beizi",
    local: true,
    name: "褙子",
    prompt:
      "Song dynasty beizi jacket, straight collar with front opening, side slits, pale muted colors, light layered chiffon, scholarly refined aura, minimalist Chinese costume",
    tags: ["中式", "汉服", "宋代", "褙子", "素雅", "文人"],
  },
  {
    description: "明制飞鱼服，织金飞鱼纹，掖庭护卫装束，威严华丽",
    id: "ming-feiyifu",
    local: false,
    name: "飞鱼服",
    prompt:
      "Ming dynasty feiyifu, gold-woven flying fish motifs, imperial guard uniform, dark blue brocade, standing collar, majestic and ornate, historical Chinese warrior costume",
    tags: ["中式", "汉服", "明代", "飞鱼服", "织金", "护卫"],
  },
  {
    description: "海派旗袍，修身剪影立领开衩，丝绸光泽，成熟优雅",
    id: "qipao-shanghai",
    local: true,
    name: "旗袍",
    prompt:
      "Shanghai style qipao cheongsam, fitted silhouette, stand collar and side slit, glossy silk fabric, floral print, mature elegant charm, vintage Chinese dress",
    tags: ["中式", "旗袍", "民国", "修身", "丝绸", "优雅"],
  },
  {
    description: "唐装，对襟盘扣锦缎上衣，喜庆团圆，节日感",
    id: "tangzhuang",
    local: true,
    name: "唐装",
    prompt:
      "Chinese tangzhuang jacket, front opening with frog buttons, brocade fabric, red and gold festive colors, mandarin collar, traditional festival clothing",
    tags: ["中式", "唐装", "盘扣", "锦缎", "节日"],
  },
  {
    description: "长衫马褂，民国文人装束，深色马褂配长袍，儒雅",
    id: "changshan-magua",
    local: false,
    name: "长衫马褂",
    prompt:
      "Republican era changshan magua, dark short jacket over long robe, mandarin collar, refined scholar look, muted ink colors, vintage Chinese gentleman attire",
    tags: ["中式", "民国", "长衫", "马褂", "文人"],
  },
  {
    description: "中山装，立领四口袋，简洁庄重，近代礼服",
    id: "zhongshanzhuang",
    local: true,
    name: "中山装",
    prompt:
      "Zhongshan suit, stand collar with four pockets, dark gray fabric, clean stern silhouette, modern Chinese formal wear, understated and dignified",
    tags: ["中式", "中山装", "立领", "庄重", "近代"],
  },
  {
    description: "新中式改良旗袍，保留立领盘扣，拼接薄纱与现代剪裁",
    id: "new-chinese-qipao",
    local: true,
    name: "新中式旗袍",
    prompt:
      "modern new Chinese style qipao, stand collar and frog buttons, sheer mesh panels, contemporary tailoring, jade green and ivory, elegant fusion fashion",
    tags: ["中式", "新中式", "改良", "旗袍", "薄纱"],
  },
  {
    description: "戏曲青衣戏服，水袖长甩，素色帔，端庄凄婉",
    id: "opera-qingyi",
    local: false,
    name: "青衣戏服",
    prompt:
      "Chinese opera qingyi costume, long flowing water sleeves, pale plain mantle, intricate embroidery, dramatic stage attire, dignified and sorrowful",
    tags: ["中式", "戏曲", "青衣", "水袖", "舞台"],
  },
  {
    description: "戏曲花旦戏服，艳丽靠服，绒球头面，活泼俏丽",
    id: "opera-huadan",
    local: false,
    name: "花旦戏服",
    prompt:
      "Chinese opera huadan costume, bright red and pink layered armor, pompom headdress, ornate embroidery, lively charming stage character, theatrical",
    tags: ["中式", "戏曲", "花旦", "靠服", "艳丽"],
  },
  {
    description: "满族旗装，宽大直筒，花盆底鞋，刺绣如意云纹",
    id: "man-qizhuang",
    local: false,
    name: "旗装",
    prompt:
      "Manchu qizhuang, wide straight robe, platform shoes, embroidered ruyi cloud patterns, Qing dynasty court style, tall headdress, stately and ornate",
    tags: ["中式", "清代", "旗装", "刺绣", "宫廷"],
  },
  {
    description: "大氅披风，织锦披肩配系带，北方冬装，厚重华美",
    id: "han-dachang",
    local: false,
    name: "大氅",
    prompt:
      "traditional Chinese dachang cloak, brocade cape with tie strings, thick winter outerwear, fur trim, deep blue and gold, warm and luxurious",
    tags: ["中式", "大氅", "披风", "冬季", "织锦"],
  },
];
