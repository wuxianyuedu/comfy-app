import { PrismaClient } from "@prisma/client";
import { syncModels } from "../src/lib/models";

const prisma = new PrismaClient();

async function main() {
  const count = await syncModels();
  console.log(`✓ 同步本地模型完成，共 ${count} 个可用模型。`);

  // Demo accounts so the UI has data to show before real signups.
  const demoEmail = "demo@comfy.app";
  const existed = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (!existed) {
    await prisma.user.create({
      data: {
        email: demoEmail,
        name: "体验用户",
        passwordHash: "demo-not-used",
      },
    });
    console.log("✓ 已创建演示账号 demo@comfy.app");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
