import { Module } from '@nestjs/common'
import { google } from 'googleapis'
import { readGoogleDriveOptions } from './gdrive.env'
import { GD_CLIENT, GD_OPTIONS } from './google-drive.tokens'
import { GoogleDriveService } from './google-drive.service'

@Module({
    providers: [
        {
            provide: GD_OPTIONS,
            useFactory: () => readGoogleDriveOptions(),
        },
        {
            provide: GD_CLIENT,
            useFactory: (opts: ReturnType<typeof readGoogleDriveOptions>) => {
                const auth = new google.auth.JWT({
                    email: opts.credentials.client_email,
                    key: opts.credentials.private_key,
                    scopes: ['https://www.googleapis.com/auth/drive'],
                })
                return google.drive({ version: 'v3', auth })
            },
            inject: [GD_OPTIONS],
        },
        GoogleDriveService,
    ],
    exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
