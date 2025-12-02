import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

export interface MailAddress {
    email: string
    name?: string
}

type MailRecipient = string | MailAddress

export interface SendMailOptions {
    to: MailRecipient | MailRecipient[]
    cc?: MailRecipient | MailRecipient[]
    bcc?: MailRecipient | MailRecipient[]
    replyTo?: MailRecipient | MailRecipient[]
    subject: string
    text?: string
    html?: string
    attachments?: {
        filename: string
        content: Buffer | string
        contentType?: string
    }[]
}

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name)
    private readonly transporter: nodemailer.Transporter

    constructor() {
        const host = process.env.MAIL_HOST
        const port = Number(process.env.MAIL_PORT || 587)
        const secure = process.env.MAIL_SECURE === 'true'
        const user = process.env.MAIL_USER
        const pass = process.env.MAIL_PASS

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: user && pass ? { user, pass } : undefined,
        })
    }
    private normalizeRecipient(rec?: MailRecipient | MailRecipient[]) {
        if (!rec) return undefined
        const arr = Array.isArray(rec) ? rec : [rec]
        return arr.map((r) => (typeof r === 'string' ? r : r.name ? `"${r.name}" <${r.email}>` : r.email))
    }

    async sendMail(options: SendMailOptions) {
        const from = process.env.MAIL_FROM || process.env.MAIL_USER
        const to = this.normalizeRecipient(options.to)
        const cc = this.normalizeRecipient(options.cc)
        const bcc = this.normalizeRecipient(options.bcc)
        const replyTo = this.normalizeRecipient(options.replyTo)

        const mailOptions: nodemailer.SendMailOptions = {
            from,
            to,
            cc,
            bcc,
            replyTo: replyTo?.[0],
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments,
        }

        this.logger.log(`Sending email | to=${to} | cc=${cc} | subject="${options.subject}"`)

        const info = await this.transporter.sendMail(mailOptions)

        this.logger.log(`Email sent | messageId=${info.messageId} | response=${info.response}`)

        return info
    }
}
