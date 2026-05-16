import { Injectable } from '@nestjs/common'
import axios from 'axios'

@Injectable()
export class VcbFxService {
    private readonly url = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10'

    async getUsdSellRate() {
        const response = await axios.get(this.url, {
            timeout: 15000,
        })

        const xml = String(response.data || '')

        const usdMatch = xml.match(/CurrencyCode="USD"[\s\S]*?Transfer="([^"]+)"[\s\S]*?Sell="([^"]+)"/)

        if (!usdMatch) {
            throw new Error('USD_RATE_NOT_FOUND')
        }

        const transfer = Number(usdMatch[1].replaceAll(',', ''))

        const sell = Number(usdMatch[2].replaceAll(',', ''))

        return {
            currency: 'USD',
            transfer,
            sell,
            fetchedAt: new Date().toISOString(),
        }
    }
}
