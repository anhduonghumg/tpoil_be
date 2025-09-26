import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
    const hash = await bcrypt.hash('admin@tpoil', 12)

    await prisma.user.upsert({
        where: { email: 'admin@tpoil.com' },
        update: {},
        create: {
            username: 'admin',
            email: 'admin@tpoil.com',
            password: hash,
            name: 'Admin',
            isActive: true,
        },
    })
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
