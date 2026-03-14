import { db, usersTable, companiesTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

export async function seedIfEmpty() {
  try {
    const existingUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    if (existingUsers.length > 0) return;

    console.log("Database is empty, seeding initial data...");

    const [clientCompany] = await db
      .insert(companiesTable)
      .values({ name: "TechCorp A.Ş.", type: "client", isActive: true })
      .returning();

    const [vendorCompany] = await db
      .insert(companiesTable)
      .values({ name: "Staffing Pro Ltd.", type: "vendor", isActive: true })
      .returning();

    const adminHash = await bcrypt.hash("admin123", 10);
    const clientHash = await bcrypt.hash("client123", 10);
    const vendorHash = await bcrypt.hash("vendor123", 10);

    await db.insert(usersTable).values([
      {
        email: "admin@ats.com",
        name: "Admin Kullanıcı",
        passwordHash: adminHash,
        role: "admin",
        companyId: null,
        isActive: true,
      },
      {
        email: "hr@techcorp.com",
        name: "HR Manager",
        passwordHash: clientHash,
        role: "client",
        companyId: clientCompany.id,
        isActive: true,
      },
      {
        email: "vendor@staffingpro.com",
        name: "Vendor User",
        passwordHash: vendorHash,
        role: "vendor",
        companyId: vendorCompany.id,
        isActive: true,
      },
    ]);

    console.log("Seed complete: admin@ats.com / admin123, hr@techcorp.com / client123, vendor@staffingpro.com / vendor123");
  } catch (err) {
    console.error("Seed error:", err);
  }
}
