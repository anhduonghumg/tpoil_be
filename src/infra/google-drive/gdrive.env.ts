export type GoogleSaCredentials = {
    type?: 'service_account'
    project_id?: string
    private_key_id?: string
    private_key: string
    client_email: string
    client_id?: string
    token_uri?: string
}

export type GoogleDriveOptions = {
    rootFolderId: string
    credentials: GoogleSaCredentials
}

export function readGoogleDriveOptions(): GoogleDriveOptions {
    const rootFolderId = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim()
    if (!rootFolderId) throw new Error('Missing GOOGLE_DRIVE_ROOT_FOLDER_ID')

    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON')

    let creds: any
    try {
        creds = JSON.parse(raw)
    } catch {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be valid single-line JSON')
    }

    if (!creds?.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing client_email')
    if (!creds?.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing private_key')

    creds.private_key = String(creds.private_key).replace(/\\n/g, '\n')

    return {
        rootFolderId,
        credentials: creds as GoogleSaCredentials,
    }
}
