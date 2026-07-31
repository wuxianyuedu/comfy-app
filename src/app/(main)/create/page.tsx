import { CreateStudio } from "@/components/create/create-studio";

export const metadata = { title: "创作台 · Comfy-APP" };

export default function CreatePage() {
  return (
    <div className="py-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">创作台</h1>
      <CreateStudio />
    </div>
  );
}
