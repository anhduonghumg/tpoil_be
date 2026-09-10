import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator'

export class CreateContractTypeDto {
    @IsString()
    code!: string

    @IsString()
    name!: string

    @IsOptional()
    @IsString()
    description?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number

    /**
     * Loại hợp đồng này có cho phép mua bán xăng dầu không. Đơn mua/đơn bán đòi đối tác
     * phải có hợp đồng còn hiệu lực thuộc một loại đã bật cờ này.
     */
    @IsOptional()
    @IsBoolean()
    allowsTrading?: boolean
}
