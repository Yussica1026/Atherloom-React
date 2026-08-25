import type { WorldDefinition } from "./types";

export interface WorldTemplate {
  id: string;
  eyebrow: string;
  name: string;
  summary: string;
  definition: WorldDefinition;
}

export const worldTemplates: WorldTemplate[] = [
  {
    id: "mist-harbor",
    eyebrow: "潮汐悬疑",
    name: "雾港回声",
    summary: "一座会记住选择的沿海城镇。旧站台、没有寄出的信与不肯离站的人仍在等待。",
    definition: {
      name: "雾港回声",
      description: "潮水每天抹去一部分脚印，却抹不去雾港居民彼此留下的承诺。你在潮汐阁楼醒来，手边只有一张写着明日日期的旧车票。",
      starting_location_id: "tide-attic",
      locations: [
        { id: "tide-attic", name: "潮汐阁楼", description: "窗框被盐雾磨白，远处旧车站的钟总慢七分钟。", exits: ["lantern-alley"] },
        { id: "lantern-alley", name: "灯影巷", description: "纸灯沿窄巷低垂，风一吹便露出墙上层层叠叠的旧寻人启事。", exits: ["tide-attic", "old-station", "rain-garden"] },
        { id: "old-station", name: "旧车站", description: "售票窗已经封死，守站人仍会为不存在的末班车擦亮信号灯。", exits: ["lantern-alley"] },
        { id: "rain-garden", name: "雨生花园", description: "只有落雨时才开门的庭院，花贩说每一株花都记得一个名字。", exits: ["lantern-alley"] },
      ],
      items: [
        { id: "dated-ticket", name: "明日车票", description: "票面日期是明天，背面写着：不要独自登车。", initial_location_id: "tide-attic" },
        { id: "brass-key", name: "黄铜钥匙", description: "齿纹像一段被截断的铁轨。", initial_location_id: "rain-garden" },
      ],
      npcs: [
        { id: "station-keeper", name: "守站人", description: "记得每位乘客，却拒绝说出自己的名字。", initial_location_id: "old-station" },
        { id: "flower-seller", name: "阿缄", description: "雨生花园的花贩，习惯替别人保管没有寄出的信。", initial_location_id: "rain-garden" },
      ],
      facts: [
        { id: "clock-delay", text: "雾港所有时钟都比海潮慢七分钟。", initially_known_by_player: true },
        { id: "last-train", text: "末班车并没有真正离站。", initially_known_by_player: false },
      ],
      quests: [
        { id: "find-platform", title: "寻找旧站台", description: "向守站人确认那座从地图上消失的站台。", initial_status: "available" },
        { id: "unsent-letter", title: "没有寄出的信", description: "找到信件真正的收件人。", initial_status: "hidden" },
      ],
    },
  },
  {
    id: "star-inn",
    eyebrow: "温柔科幻",
    name: "星穹旅店",
    summary: "漂泊在航路夹缝中的旅店，只接待错过目的地的人。每扇客房门后都是不同的天空。",
    definition: {
      name: "星穹旅店",
      description: "你在星穹旅店的观景厅醒来。航路图上没有这座旅店，但大堂登记簿已经写好了你的名字。",
      starting_location_id: "observatory",
      locations: [
        { id: "observatory", name: "观景厅", description: "整面舷窗外是缓慢旋转的星云，玻璃上留着一枚小小手印。", exits: ["lobby"] },
        { id: "lobby", name: "无刻大堂", description: "这里没有钟。登记簿会自行翻到刚刚抵达的那一页。", exits: ["observatory", "signal-room", "door-gallery"] },
        { id: "signal-room", name: "信号室", description: "旧式收发器不断接收来自尚未发生之日的短讯。", exits: ["lobby"] },
        { id: "door-gallery", name: "百门长廊", description: "房门铭牌只写天气，不写房号。", exits: ["lobby"] },
      ],
      items: [
        { id: "room-card", name: "空白房卡", description: "贴近耳边时能听见很远的雨。", initial_location_id: "observatory" },
        { id: "signal-fragment", name: "信号碎片", description: "一小段凝固的蓝白噪声，触碰时会浮出坐标。", initial_location_id: "signal-room" },
      ],
      npcs: [
        { id: "innkeeper", name: "弥朔", description: "旅店代理掌柜，说自己只负责替旅客保管归途。", initial_location_id: "lobby" },
        { id: "lost-guest", name: "小满", description: "忘了自己从哪颗星球来的孩子，正在寻找一扇下雨的门。", initial_location_id: "door-gallery" },
      ],
      facts: [
        { id: "off-chart", text: "星穹旅店不在任何公开航路图上。", initially_known_by_player: true },
        { id: "future-signal", text: "信号室收到的求救讯息来自三日之后。", initially_known_by_player: false },
      ],
      quests: [
        { id: "choose-door", title: "寻找下雨的门", description: "陪小满在百门长廊寻找记忆中的雨声。", initial_status: "available" },
        { id: "answer-signal", title: "回复未来", description: "查明三日后的求救信号来自何处。", initial_status: "hidden" },
      ],
    },
  },
  {
    id: "mountain-post",
    eyebrow: "山海奇谈",
    name: "山海邮局",
    summary: "云岭尽头的旧邮局替人、妖与山川投递未尽之言。有些信要走很多年才能抵达。",
    definition: {
      name: "山海邮局",
      description: "你接过了山海邮局今日的临时工牌。第一封信没有地址，信封上只画着一座会走路的山。",
      starting_location_id: "post-hall",
      locations: [
        { id: "post-hall", name: "邮局前堂", description: "木格里挤满贴着羽毛、鳞片与叶脉邮票的信件。", exits: ["cloud-road", "archive"] },
        { id: "cloud-road", name: "云背驿道", description: "石阶浮在云海上，路牌会随着收信人的心意转向。", exits: ["post-hall", "listening-pine"] },
        { id: "listening-pine", name: "听信松", description: "古松枝梢挂着许多无人领取的回音。", exits: ["cloud-road"] },
        { id: "archive", name: "无址档案室", description: "寄不出去的信在这里长成薄薄的纸鸟。", exits: ["post-hall"] },
      ],
      items: [
        { id: "nameless-letter", name: "无址来信", description: "信封上的山峰每次眨眼都会换一个位置。", initial_location_id: "post-hall" },
        { id: "echo-stamp", name: "回音邮票", description: "贴在信上，可以让收件人听见寄信人当时的声音。", initial_location_id: "archive" },
      ],
      npcs: [
        { id: "postmaster", name: "鹤九", description: "白发邮差，从不拆信，却知道每封信有多重。", initial_location_id: "post-hall" },
        { id: "pine-spirit", name: "松迟", description: "替听信松看守回音的小妖，欠别人一句迟到多年的道歉。", initial_location_id: "listening-pine" },
      ],
      facts: [
        { id: "address-rule", text: "山海邮局认心意，不认地图上的地址。", initially_known_by_player: true },
        { id: "walking-mountain", text: "那座会走路的山只在月影朝北时停下。", initially_known_by_player: false },
      ],
      quests: [
        { id: "deliver-letter", title: "投递无址来信", description: "查出画中山峰的去向，把信交给真正的收件人。", initial_status: "available" },
        { id: "return-echo", title: "归还一声道歉", description: "在听信松上找到属于松迟的那道回音。", initial_status: "hidden" },
      ],
    },
  },
];

export function cloneTemplateDefinition(template: WorldTemplate): WorldDefinition {
  return JSON.parse(JSON.stringify(template.definition)) as WorldDefinition;
}
