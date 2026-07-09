import { Type } from 'class-transformer'
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsIn,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
    ValidateNested,
} from 'class-validator'
import {
    DriverDocumentType,
    ExpectedInventorySourceType,
    InspectionType,
    OperationRegistrationStatus,
    OperationalPartyRole,
    ShipCharterOrderSourceType,
    ShipCharterOrderStatus,
    StorageRentalContractStatus,
    TermTransportMode,
    VehicleDispatchSourceType,
    VehicleDispatchStatus,
    VehicleDocumentType,
    WarehouseOwnerType,
    WarehouseReservationSourceType,
    WarehouseTransferStatus,
} from '@prisma/client'

export class PageQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    pageSize = 30

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsString()
    status?: string
}

export class CreateOperationalRoleDto {
    @IsUUID()
    customerId!: string

    @IsEnum(OperationalPartyRole)
    role!: OperationalPartyRole

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertVesselDto {
    @IsString()
    @IsNotEmpty()
    name!: string

    @IsUUID()
    ownerCustomerId!: string

    @IsOptional()
    @IsString()
    imoNo?: string

    @IsOptional()
    @IsString()
    nationality?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    deadweightTonnage?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    capacity?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    length?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    width?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    draft?: number

    @IsOptional()
    allowedCargoTypes?: unknown

    @IsOptional()
    @IsString()
    documentFileUrl?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertShipCharterContractDto {
    @IsString()
    @IsNotEmpty()
    contractNo!: string

    @IsUUID()
    ownerCustomerId!: string

    @IsDateString()
    signedDate!: string

    @IsDateString()
    effectiveFrom!: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertShipCharterAppendixDto {
    @IsUUID()
    contractId!: string

    @IsString()
    @IsNotEmpty()
    appendixNo!: string

    @IsDateString()
    appendixDate!: string

    @IsOptional()
    @IsUUID()
    vesselId?: string

    @IsOptional()
    @IsString()
    cargoName?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    plannedQty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    qtyTolerancePercent?: number

    @IsOptional()
    @IsString()
    loadingPort?: string

    @IsOptional()
    @IsString()
    dischargePort?: string

    @IsOptional()
    @IsDateString()
    laycanFrom?: string

    @IsOptional()
    @IsDateString()
    laycanTo?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    freightRateVndPerLiter?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    lossRatePercent?: number

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertShipCharterOrderDto {
    @IsString()
    @IsNotEmpty()
    charterOrderNo!: string

    @IsOptional()
    @IsEnum(ShipCharterOrderSourceType)
    sourceType?: ShipCharterOrderSourceType

    @IsOptional()
    @IsUUID()
    purchaseOrderId?: string

    @IsOptional()
    @IsUUID()
    termShipmentId?: string

    @IsOptional()
    @IsUUID()
    appendixId?: string

    @IsOptional()
    @IsUUID()
    ownerCustomerId?: string

    @IsOptional()
    @IsUUID()
    vesselId?: string

    @IsOptional()
    @IsDateString()
    laycanFrom?: string

    @IsOptional()
    @IsDateString()
    laycanTo?: string

    @IsOptional()
    @IsString()
    cargoName?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.001)
    plannedQty!: number

    @IsOptional()
    @IsString()
    loadingPort?: string

    @IsOptional()
    @IsString()
    dischargePort?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    freightRateVndPerLiter?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    lossRatePercent?: number

    @IsOptional()
    @IsEnum(ShipCharterOrderStatus)
    status?: ShipCharterOrderStatus

    @IsOptional()
    @IsString()
    appendixFileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertCharterInsuranceDto {
    @IsUUID()
    insuranceCompanyId!: string

    @IsOptional()
    @IsString()
    policyNo?: string

    @IsOptional()
    @IsDateString()
    policyDate?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    insuredValue?: number

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    premiumAmount!: number

    @IsOptional()
    @IsDateString()
    effectiveFrom?: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsEnum(OperationRegistrationStatus)
    status?: OperationRegistrationStatus

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertCharterInspectionDto {
    @IsUUID()
    inspectionCompanyId!: string

    @IsEnum(InspectionType)
    inspectionType!: InspectionType

    @IsOptional()
    @IsDateString()
    registeredDate?: string

    @IsOptional()
    @IsDateString()
    plannedInspectionDate?: string

    @IsOptional()
    @IsString()
    certificateNo?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    feeAmount?: number

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsEnum(OperationRegistrationStatus)
    status?: OperationRegistrationStatus

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertShippingAgentDto {
    @IsUUID()
    agentCustomerId!: string

    @IsOptional()
    @IsDateString()
    registeredDate?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    agencyFee!: number

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsEnum(OperationRegistrationStatus)
    status?: OperationRegistrationStatus

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertShipFreightRateDto {
    @IsOptional()
    @IsUUID()
    ownerCustomerId?: string

    @IsOptional()
    @IsUUID()
    vesselId?: string

    @IsString()
    loadingPort!: string

    @IsString()
    dischargePort!: string

    @IsOptional()
    @IsString()
    productGroup?: string

    @Type(() => Number)
    @IsNumber()
    freightRateVndPerLiter!: number

    @IsDateString()
    effectiveFrom!: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class StorageLossRateDto {
    @IsString()
    productGroup!: string

    @Type(() => Number)
    @IsNumber()
    storageLossRatePercent!: number

    @Type(() => Number)
    @IsNumber()
    issueLossRatePercent!: number
}

export class StorageFeeTierDto {
    @IsString()
    conditionText!: string

    @Type(() => Number)
    @IsNumber()
    unitPriceVndPerLiter!: number

    @IsOptional()
    @IsString()
    unit?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    sortOrder?: number
}

export class UpsertStorageRentalContractDto {
    @IsString()
    contractNo!: string

    @IsUUID()
    lessorCustomerId!: string

    @IsOptional()
    @IsDateString()
    effectiveFrom?: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsOptional()
    @IsString()
    currency?: string

    @IsOptional()
    @IsEnum(StorageRentalContractStatus)
    status?: StorageRentalContractStatus

    @IsOptional()
    @IsString()
    fileName?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @IsUUID('4', { each: true })
    supplierLocationIds!: string[]

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StorageLossRateDto)
    lossRates?: StorageLossRateDto[]

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StorageFeeTierDto)
    feeTiers?: StorageFeeTierDto[]
}

export class PostStorageTermCostDto {
    @IsUUID()
    purchaseOrderId!: string

    @IsIn(["STORAGE", "LOSS"])
    costType!: "STORAGE" | "LOSS"

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amountVnd!: number

    @IsOptional()
    @IsString()
    documentNo?: string

    @IsOptional()
    @IsDateString()
    documentDate?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class OwnerDto {
    @IsEnum(WarehouseOwnerType)
    ownerType!: WarehouseOwnerType

    @IsOptional()
    @IsUUID()
    ownerCustomerId?: string
}

export class CreateExpectedInventoryDto extends OwnerDto {
    @IsEnum(ExpectedInventorySourceType)
    sourceType!: ExpectedInventorySourceType

    @IsUUID()
    sourceId!: string

    @IsUUID()
    supplierLocationId!: string

    @IsUUID()
    productId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.001)
    expectedQty!: number

    @IsOptional()
    @IsDateString()
    expectedDate?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class AllocateExpectedInventoryDto {
    @IsUUID()
    goodsReceiptId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.001)
    allocatedQty!: number
}

export class CreateWarehouseReservationDto {
    @IsString()
    reservationNo!: string

    @IsUUID()
    supplierLocationId!: string

    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    customerId?: string

    @IsOptional()
    @IsEnum(WarehouseReservationSourceType)
    sourceType?: WarehouseReservationSourceType

    @IsOptional()
    @IsUUID()
    sourceId?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.001)
    reservedQty!: number

    @IsOptional()
    @IsDateString()
    reservedAt?: string

    @IsOptional()
    @IsDateString()
    expiredAt?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class WarehouseTransferLineDto {
    @IsUUID()
    productId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.001)
    qty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    qtyV15?: number

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertWarehouseTransferDto extends OwnerDto {
    @IsString()
    transferNo!: string

    @IsUUID()
    fromSupplierLocationId!: string

    @IsUUID()
    toSupplierLocationId!: string

    @IsDateString()
    transferDate!: string

    @IsOptional()
    @IsDateString()
    expectedArrivalDate?: string

    @IsOptional()
    @IsDateString()
    actualArrivalDate?: string

    @IsOptional()
    @IsEnum(TermTransportMode)
    transportMode?: TermTransportMode

    @IsOptional()
    @IsUUID()
    vehicleId?: string

    @IsOptional()
    @IsUUID()
    driverId?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => WarehouseTransferLineDto)
    lines!: WarehouseTransferLineDto[]
}

export class ChangeWarehouseTransferStatusDto {
    @IsEnum(WarehouseTransferStatus)
    status!: WarehouseTransferStatus

    @IsOptional()
    @IsDateString()
    actualArrivalDate?: string
}

export class UpsertVehicleDocumentDto {
    @IsEnum(VehicleDocumentType)
    documentType!: VehicleDocumentType

    @IsOptional()
    @IsString()
    documentNo?: string

    @IsOptional()
    @IsDateString()
    issuedDate?: string

    @IsOptional()
    @IsDateString()
    expiredDate?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertVehicleDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsString()
    @IsNotEmpty()
    licensePlate!: string

    @IsOptional()
    @IsString()
    type?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    capacity?: number

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertDriverDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsString()
    @IsNotEmpty()
    fullName!: string

    @IsOptional()
    @IsString()
    phone?: string

    @IsOptional()
    @IsString()
    idCard?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertDriverDocumentDto {
    @IsEnum(DriverDocumentType)
    documentType!: DriverDocumentType

    @IsOptional()
    @IsString()
    documentNo?: string

    @IsOptional()
    @IsDateString()
    issuedDate?: string

    @IsOptional()
    @IsDateString()
    expiredDate?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpsertVehicleDispatchDto {
    @IsString()
    dispatchNo!: string

    @IsOptional()
    @IsEnum(VehicleDispatchSourceType)
    sourceType?: VehicleDispatchSourceType

    @IsOptional()
    @IsUUID()
    sourceId?: string

    @IsOptional()
    @IsUUID()
    warehouseTransferId?: string

    @IsUUID()
    vehicleId!: string

    @IsUUID()
    driverId!: string

    @IsString()
    fromLocationText!: string

    @IsString()
    toLocationText!: string

    @IsOptional()
    @IsUUID()
    fromSupplierLocationId?: string

    @IsOptional()
    @IsUUID()
    toSupplierLocationId?: string

    @IsOptional()
    @IsUUID()
    productId?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    plannedQty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    actualQty?: number

    @IsDateString()
    plannedStartAt!: string

    @IsOptional()
    @IsDateString()
    actualStartAt?: string

    @IsOptional()
    @IsDateString()
    actualEndAt?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    transportFeeVnd?: number

    @IsOptional()
    @IsEnum(VehicleDispatchStatus)
    status?: VehicleDispatchStatus

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class ChangeVehicleDispatchStatusDto {
    @IsEnum(VehicleDispatchStatus)
    status!: VehicleDispatchStatus

    @IsOptional()
    @IsDateString()
    at?: string
}
