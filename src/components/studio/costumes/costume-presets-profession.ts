/**
 * 服饰库 · 职业 / 功能（18 条）。静态数据：新增一款只加一条，id 全库唯一。
 */
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

export const costumePresetsProfession: ReadonlyArray<ResearchPreset> = [
  {
    description: "白大褂，内搭衬衫配听诊器，医生职业装",
    id: "job-doctor",
    local: true,
    name: "医生白大褂",
    prompt:
      "Doctor in white lab coat, dress shirt underneath, stethoscope around neck, clean professional appearance, hospital setting",
    tags: ["职业", "医生", "白大褂", "听诊器", "医院"],
  },
  {
    description: "护士服，浅蓝制服配护士帽，亲切洁净",
    id: "job-nurse",
    local: true,
    name: "护士服",
    prompt:
      "Nurse in light blue uniform with white cap, gentle caring expression, clean professional medical attire, ward setting",
    tags: ["职业", "护士", "制服", "浅蓝", "亲切"],
  },
  {
    description: "警服，深蓝制服配警帽与徽章，庄重威严",
    id: "job-police",
    local: false,
    name: "警服",
    prompt:
      "Police officer in dark navy uniform, peaked cap with badge, formal duty attire, stern and authoritative bearing",
    tags: ["职业", "警察", "制服", "徽章", "威严"],
  },
  {
    description: "军装礼服，呢料大檐帽配绶带与勋章，仪仗队",
    id: "job-military",
    local: false,
    name: "军装礼服",
    prompt:
      "Military ceremonial uniform, wool greatcoat with peaked cap, medal ribbons and sash, honor guard posture, dignified",
    tags: ["职业", "军装", "礼服", "勋章", "仪仗"],
  },
  {
    description: "消防服，橙色阻燃外套配反光条与头盔",
    id: "job-firefighter",
    local: false,
    name: "消防服",
    prompt:
      "Firefighter turnout gear, orange flame-resistant coat with reflective stripes, helmet and gloves, rescue scene, brave",
    tags: ["职业", "消防", "反光条", "头盔", "救援"],
  },
  {
    description: "厨师服，白色双排扣配高帽，专业厨房",
    id: "job-chef",
    local: true,
    name: "厨师服",
    prompt:
      "Chef uniform, white double-breasted jacket with tall toque hat, apron, professional kitchen background, focused",
    tags: ["职业", "厨师", "双排扣", "高帽", "厨房"],
  },
  {
    description: "飞行员制服，藏蓝西装配大檐帽与肩章",
    id: "job-pilot",
    local: false,
    name: "飞行员制服",
    prompt:
      "Airline pilot uniform, navy blazer with epaulets and peaked cap, crisp shirt and tie, confident professional demeanor",
    tags: ["职业", "飞行员", "肩章", "大檐帽", "制服"],
  },
  {
    description: "宇航服，白色舱内服配生命维持背包与透明头盔",
    id: "job-astronaut",
    local: true,
    name: "宇航服",
    prompt:
      "Astronaut spacesuit, white pressure suit with life support backpack, transparent helmet reflecting stars, spacewalk scene",
    tags: ["职业", "宇航员", "航天", "头盔", "太空"],
  },
  {
    description: "教师套装，米色开衫配衬衫，知性温和",
    id: "job-teacher",
    local: true,
    name: "教师套装",
    prompt:
      "Teacher outfit, beige cardigan over blouse, reading glasses, gentle intellectual aura, classroom background",
    tags: ["职业", "教师", "开衫", "知性", "教室"],
  },
  {
    description: "科研服，白色实验服配护目镜与手套，实验室",
    id: "job-scientist",
    local: true,
    name: "科研服",
    prompt:
      "Scientist in white lab coat with safety goggles and gloves, laboratory equipment behind, curious focused expression",
    tags: ["职业", "科研", "实验服", "护目镜", "实验室"],
  },
  {
    description: "工程师工装，黄色安全帽配反光背心与工具腰带",
    id: "job-engineer",
    local: false,
    name: "工程师工装",
    prompt:
      "Engineer workwear, yellow hard hat with reflective vest and tool belt, construction site, practical and sturdy",
    tags: ["职业", "工程师", "安全帽", "反光背心", "工地"],
  },
  {
    description: "法官袍，黑色法袍配白色领饰，法庭庄严",
    id: "job-judge",
    local: false,
    name: "法官袍",
    prompt:
      "Judge robe, black judicial gown with white jabot, courtroom setting, solemn and authoritative presence",
    tags: ["职业", "法官", "法袍", "法庭", "庄严"],
  },
  {
    description: "律师西装，深色三件套配公文包，干练理性",
    id: "job-lawyer",
    local: true,
    name: "律师西装",
    prompt:
      "Lawyer in dark tailored suit with briefcase, confident rational expression, office corridor background, professional",
    tags: ["职业", "律师", "西装", "公文包", "干练"],
  },
  {
    description: "服务员制服，深色马甲配领结与托盘，餐厅",
    id: "job-waiter",
    local: false,
    name: "服务员制服",
    prompt:
      "Waiter uniform, dark vest with bow tie and white shirt, carrying a tray, restaurant interior, courteous posture",
    tags: ["职业", "服务员", "马甲", "领结", "餐厅"],
  },
  {
    description: "快递员，轻便夹克配工作帽与背包，城市街道",
    id: "job-courier",
    local: false,
    name: "快递员",
    prompt:
      "Delivery courier, lightweight jacket with company cap and delivery backpack, city street, energetic and practical",
    tags: ["职业", "快递", "夹克", "背包", "街道"],
  },
  {
    description: "农夫，草帽配粗布衬衫与围裙，田园",
    id: "job-farmer",
    local: false,
    name: "农夫",
    prompt:
      "Farmer in straw hat, rough cotton shirt and apron, rural field background, sun-warmed earthy look",
    tags: ["职业", "农夫", "草帽", "粗布", "田园"],
  },
  {
    description: "渔夫，防水外套配胶靴与渔网，海边码头",
    id: "job-fisher",
    local: false,
    name: "渔夫",
    prompt:
      "Fisher in waterproof jacket with rubber boots and fishing net, harbor dock background, weathered and hardy",
    tags: ["职业", "渔夫", "防水", "胶靴", "码头"],
  },
  {
    description: "矿工，厚重工作服配矿灯安全帽，矿井入口",
    id: "job-miner",
    local: false,
    name: "矿工",
    prompt:
      "Miner in heavy workwear with helmet lamp, dust-covered gear, mine entrance, rugged and resilient",
    tags: ["职业", "矿工", "矿灯", "安全帽", "粗犷"],
  },
];
