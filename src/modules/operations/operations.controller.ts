import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ShipCharterOrderStatus } from '@prisma/client'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import {
    AllocateExpectedInventoryDto,
    ChangeVehicleDispatchStatusDto,
    ChangeWarehouseTransferStatusDto,
    CreateExpectedInventoryDto,
    CreateAppendixFromOrderDto,
    CreateCharterOrderFromTermDto,
    ConfirmCharterOrderDto,
    CreateOperationalRoleDto,
    CreateShipOwnerDto,
    CreateVesselDocumentDto,
    CreateWarehouseReservationDto,
    PageQueryDto,
    ShipOwnerListQueryDto,
    ShipFreightRateLookupDto,
    UpsertCharterInsuranceDto,
    UpsertCharterInspectionDto,
    UpsertDriverDocumentDto,
    UpsertDriverDto,
    UpsertShipCharterAppendixDto,
    UpsertShipCharterContractDto,
    UpsertShipCharterOrderDto,
    UpsertShipFreightRateDto,
    UpsertShippingAgentDto,
    UpsertStorageRentalContractDto,
    UpsertVehicleDispatchDto,
    UpsertVehicleDocumentDto,
    UpsertVehicleDto,
    UpsertVesselDto,
    UpdateShipOwnerDto,
    UpdateVesselDocumentDto,
    UpdateVesselDto,
    VesselDocumentListQueryDto,
    VesselListQueryDto,
    UpsertWarehouseTransferDto,
    PostStorageTermCostDto,
    WarehouseOwnerType,
    WarehouseReservationStatus,
} from './dto/operations.dto'
import { OperationsDashboardService } from './operations-dashboard.service'
import { RoadOperationsService } from './road-operations.service'
import { ShipCharterService } from './ship-charter.service'
import { WarehouseOperationsService } from './warehouse-operations.service'

@Controller('operations')
@UseGuards(LoggedInGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.operations.view)
export class OperationsController {
    constructor(
        private readonly dashboard: OperationsDashboardService,
        private readonly charter: ShipCharterService,
        private readonly warehouse: WarehouseOperationsService,
        private readonly road: RoadOperationsService,
    ) {}

    @Get('dashboard')
    getDashboard() {
        return this.dashboard.get()
    }

    @Get('ship-charters/dashboard')
    getShipCharterDashboard() {
        return this.charter.shipCharterDashboard()
    }

    @Get('partners')
    partners(@Query('role') role?: string, @Query('keyword') keyword?: string) {
        return this.charter.listPartners(role, keyword)
    }

    @Post('partners/roles')
    @RequirePermissions(PERMISSIONS.operations.managePartners)
    savePartnerRole(@Body() dto: CreateOperationalRoleDto) {
        return this.charter.savePartnerRole(dto)
    }

    @Get('ship-owners/select')
    shipOwnerSelect(@Query('keyword') keyword?: string) {
        return this.charter.shipOwnerSelect(keyword)
    }

    @Get('ship-owners')
    shipOwners(@Query() q: ShipOwnerListQueryDto) {
        return this.charter.listShipOwners(q)
    }

    @Get('ship-owners/:customerId')
    shipOwner(@Param('customerId') customerId: string) {
        return this.charter.shipOwner(customerId)
    }

    @Get('ship-owners/:customerId/vessels')
    shipOwnerVessels(@Param('customerId') customerId: string, @Query() q: VesselListQueryDto) {
        q.ownerCustomerId = customerId
        return this.charter.listVessels(q)
    }

    @Post('ship-owners')
    @RequirePermissions(PERMISSIONS.operations.managePartners)
    createShipOwner(@Body() dto: CreateShipOwnerDto) {
        return this.charter.createShipOwner(dto)
    }

    @Patch('ship-owners/:customerId')
    @RequirePermissions(PERMISSIONS.operations.managePartners)
    updateShipOwner(@Param('customerId') customerId: string, @Body() dto: UpdateShipOwnerDto) {
        return this.charter.updateShipOwner(customerId, dto)
    }

    @Get('vessels')
    vessels(@Query() q: VesselListQueryDto) {
        return this.charter.listVessels(q)
    }

    @Get('vessels/select')
    vesselSelect(@Query() q: VesselListQueryDto) {
        return this.charter.vesselSelect(q)
    }

    @Get('vessels/:id')
    vessel(@Param('id') id: string) {
        return this.charter.vessel(id)
    }

    @Post('vessels')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createVessel(@Body() dto: UpsertVesselDto) {
        return this.charter.createVessel(dto)
    }

    @Put('vessels/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateVessel(@Param('id') id: string, @Body() dto: UpsertVesselDto) {
        return this.charter.updateVessel(id, dto)
    }

    @Patch('vessels/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchVessel(@Param('id') id: string, @Body() dto: UpdateVesselDto) {
        return this.charter.updateVessel(id, dto)
    }

    @Get('vessels/:id/documents')
    vesselDocuments(@Param('id') id: string, @Query() q: VesselDocumentListQueryDto) {
        return this.charter.listVesselDocuments(id, q)
    }

    @Post('vessels/:id/documents')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createVesselDocument(@Param('id') id: string, @Body() dto: CreateVesselDocumentDto) {
        return this.charter.createVesselDocument(id, dto)
    }

    @Patch('vessel-documents/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateVesselDocument(@Param('id') id: string, @Body() dto: UpdateVesselDocumentDto) {
        return this.charter.updateVesselDocument(id, dto)
    }

    @Get('vessels/:id/document-check')
    vesselDocumentCheck(@Param('id') id: string) {
        return this.charter.vesselDocumentCheck(id)
    }

    @Get('charter-contracts')
    charterContracts(@Query() q: PageQueryDto) {
        return this.charter.listContracts(q)
    }

    @Get('charter-contracts/:id')
    charterContract(@Param('id') id: string) {
        return this.charter.contract(id)
    }

    @Post('charter-contracts')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createCharterContract(@Body() dto: UpsertShipCharterContractDto) {
        return this.charter.saveContract(dto)
    }

    @Put('charter-contracts/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateCharterContract(@Param('id') id: string, @Body() dto: UpsertShipCharterContractDto) {
        return this.charter.saveContract(dto, id)
    }

    @Patch('charter-contracts/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchCharterContract(@Param('id') id: string, @Body() dto: UpsertShipCharterContractDto) {
        return this.charter.saveContract(dto, id)
    }

    @Get('charter-appendices')
    charterAppendices(@Query() q: PageQueryDto & { contractId?: string }) {
        return this.charter.listAppendices(q)
    }

    @Get('charter-appendices/:id')
    charterAppendix(@Param('id') id: string) {
        return this.charter.appendix(id)
    }

    @Post('charter-appendices')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createCharterAppendix(@Body() dto: UpsertShipCharterAppendixDto) {
        return this.charter.saveAppendix(dto)
    }

    @Put('charter-appendices/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateCharterAppendix(@Param('id') id: string, @Body() dto: UpsertShipCharterAppendixDto) {
        return this.charter.saveAppendix(dto, id)
    }

    @Patch('charter-appendices/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchCharterAppendix(@Param('id') id: string, @Body() dto: UpsertShipCharterAppendixDto) {
        return this.charter.saveAppendix(dto, id)
    }

    @Get('charter-orders')
    charterOrders(@Query() q: PageQueryDto & { purchaseOrderId?: string }) {
        return this.charter.listOrders(q)
    }

    @Get('charter-orders/term-pending')
    pendingTermCharterOrders(@Query() q: PageQueryDto) {
        return this.charter.listPendingTermOrders(q)
    }

    @Get('charter-orders/:id')
    charterOrder(@Param('id') id: string) {
        return this.charter.order(id)
    }

    @Post('charter-orders')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createCharterOrder(@Body() dto: UpsertShipCharterOrderDto) {
        return this.charter.saveOrder(dto)
    }

    @Post('charter-orders/from-term/:purchaseOrderId')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createCharterOrderFromTerm(
        @Param('purchaseOrderId') purchaseOrderId: string,
        @Body() dto: CreateCharterOrderFromTermDto,
    ) {
        return this.charter.createOrderFromTerm(purchaseOrderId, dto)
    }

    @Put('charter-orders/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateCharterOrder(@Param('id') id: string, @Body() dto: UpsertShipCharterOrderDto) {
        return this.charter.saveOrder(dto, id)
    }

    @Patch('charter-orders/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchCharterOrder(@Param('id') id: string, @Body() dto: UpsertShipCharterOrderDto) {
        return this.charter.saveOrder(dto, id)
    }

    @Post('charter-orders/:id/confirm')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    confirmCharterOrder(@Param('id') id: string, @Body() dto: ConfirmCharterOrderDto) {
        return this.charter.changeOrderStatus(id, ShipCharterOrderStatus.CONFIRMED, false)
    }

    @Post('charter-orders/:id/confirm-override')
    @RequirePermissions(PERMISSIONS.operations.overrideVesselDocuments)
    confirmCharterOrderWithOverride(@Param('id') id: string, @Body() dto: ConfirmCharterOrderDto) {
        return this.charter.changeOrderStatus(id, ShipCharterOrderStatus.CONFIRMED, dto.overrideDocumentCheck === true)
    }

    @Post('charter-orders/:id/create-appendix')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createAppendixFromOrder(@Param('id') id: string, @Body() dto: CreateAppendixFromOrderDto) {
        return this.charter.createAppendixFromOrder(id, dto)
    }

    @Post('charter-orders/:id/cancel')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    cancelCharterOrder(@Param('id') id: string) {
        return this.charter.changeOrderStatus(id, ShipCharterOrderStatus.CANCELLED)
    }

    @Patch('charter-orders/:id/status/:status')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    changeCharterStatus(@Param('id') id: string, @Param('status') status: any) {
        return this.charter.changeOrderStatus(id, status)
    }

    @Post('charter-orders/:id/insurances')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createInsurance(@Param('id') id: string, @Body() dto: UpsertCharterInsuranceDto) {
        return this.charter.saveInsurance(id, dto)
    }

    @Get('charter-insurances')
    charterInsurances(@Query() q: PageQueryDto) {
        return this.charter.listInsurances(q)
    }

    @Put('charter-orders/:orderId/insurances/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateInsurance(@Param('orderId') orderId: string, @Param('id') id: string, @Body() dto: UpsertCharterInsuranceDto) {
        return this.charter.saveInsurance(orderId, dto, id)
    }

    @Patch('charter-insurances/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchInsurance(@Param('id') id: string, @Body() dto: UpsertCharterInsuranceDto) {
        return this.charter.saveInsuranceForExisting(id, dto)
    }

    @Post('charter-orders/:id/inspections')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createInspection(@Param('id') id: string, @Body() dto: UpsertCharterInspectionDto) {
        return this.charter.saveInspection(id, dto)
    }

    @Get('charter-inspections')
    charterInspections(@Query() q: PageQueryDto) {
        return this.charter.listInspections(q)
    }

    @Put('charter-orders/:orderId/inspections/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateInspection(@Param('orderId') orderId: string, @Param('id') id: string, @Body() dto: UpsertCharterInspectionDto) {
        return this.charter.saveInspection(orderId, dto, id)
    }

    @Patch('charter-inspections/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchInspection(@Param('id') id: string, @Body() dto: UpsertCharterInspectionDto) {
        return this.charter.saveInspectionForExisting(id, dto)
    }

    @Post('charter-orders/:id/agents')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createAgent(@Param('id') id: string, @Body() dto: UpsertShippingAgentDto) {
        return this.charter.saveAgent(id, dto)
    }

    @Get('shipping-agent-registrations')
    shippingAgentRegistrations(@Query() q: PageQueryDto) {
        return this.charter.listAgentRegistrations(q)
    }

    @Put('charter-orders/:orderId/agents/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateAgent(@Param('orderId') orderId: string, @Param('id') id: string, @Body() dto: UpsertShippingAgentDto) {
        return this.charter.saveAgent(orderId, dto, id)
    }

    @Patch('shipping-agent-registrations/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchAgent(@Param('id') id: string, @Body() dto: UpsertShippingAgentDto) {
        return this.charter.saveAgentForExisting(id, dto)
    }

    @Post('charter-orders/:id/post-term-costs')
    @RequirePermissions(PERMISSIONS.operations.postTermCosts)
    postTermCosts(@Param('id') id: string) {
        return this.charter.postCostsToTerm(id)
    }

    @Get('freight-rates')
    freightRates(@Query() q: PageQueryDto) {
        return this.charter.listFreightRates(q)
    }

    @Get('freight-rates/lookup')
    lookupFreightRate(@Query() q: ShipFreightRateLookupDto) {
        return this.charter.lookupFreightRate(q)
    }

    @Post('freight-rates')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    createFreightRate(@Body() dto: UpsertShipFreightRateDto) {
        return this.charter.saveFreightRate(dto)
    }

    @Put('freight-rates/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    updateFreightRate(@Param('id') id: string, @Body() dto: UpsertShipFreightRateDto) {
        return this.charter.saveFreightRate(dto, id)
    }

    @Patch('freight-rates/:id')
    @RequirePermissions(PERMISSIONS.operations.charterManage)
    patchFreightRate(@Param('id') id: string, @Body() dto: UpsertShipFreightRateDto) {
        return this.charter.saveFreightRate(dto, id)
    }

    @Get('storage-contracts')
    storageContracts(@Query() q: PageQueryDto) {
        return this.warehouse.listStorageContracts(q)
    }

    @Get('storage-contracts/:id')
    storageContract(@Param('id') id: string) {
        return this.warehouse.storageContract(id)
    }

    @Post('storage-contracts')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    createStorageContract(@Body() dto: UpsertStorageRentalContractDto) {
        return this.warehouse.saveStorageContract(dto)
    }

    @Put('storage-contracts/:id')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    updateStorageContract(@Param('id') id: string, @Body() dto: UpsertStorageRentalContractDto) {
        return this.warehouse.saveStorageContract(dto, id)
    }

    @Post('storage-contracts/:id/post-term-cost')
    @RequirePermissions(PERMISSIONS.operations.postTermCosts)
    postStorageTermCost(@Param('id') id: string, @Body() dto: PostStorageTermCostDto) {
        return this.warehouse.postStorageTermCost(id, dto)
    }

    @Get('warehouse/availability')
    availability(@Query() q: PageQueryDto & { supplierLocationId?: string; productId?: string; ownerType?: WarehouseOwnerType }) {
        return this.warehouse.listAvailability(q)
    }

    @Get('warehouse/matrix')
    matrix(@Query() q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
        return this.warehouse.inventoryMatrix(q)
    }

    @Get('warehouse/commercial-lots')
    commercialLotInventory(@Query() q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
        return this.warehouse.listCommercialLotInventory(q)
    }

    @Get('expected-inventory')
    expectedInventory(@Query() q: PageQueryDto) {
        return this.warehouse.listExpected(q)
    }

    @Post('expected-inventory')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    createExpectedInventory(@Body() dto: CreateExpectedInventoryDto) {
        return this.warehouse.createExpected(dto)
    }

    @Post('expected-inventory/:id/allocate')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    allocateExpected(@Param('id') id: string, @Body() dto: AllocateExpectedInventoryDto) {
        return this.warehouse.allocateExpected(id, dto)
    }

    @Patch('expected-inventory/:id/cancel')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    cancelExpected(@Param('id') id: string) {
        return this.warehouse.cancelExpected(id)
    }

    @Get('warehouse-reservations')
    reservations(@Query() q: PageQueryDto) {
        return this.warehouse.listReservations(q)
    }

    @Post('warehouse-reservations')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    createReservation(@Body() dto: CreateWarehouseReservationDto) {
        return this.warehouse.createReservation(dto)
    }

    @Patch('warehouse-reservations/:id/:status')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    changeReservation(@Param('id') id: string, @Param('status') status: WarehouseReservationStatus) {
        return this.warehouse.changeReservation(id, status)
    }

    @Get('warehouse-transfers')
    transfers(@Query() q: PageQueryDto) {
        return this.warehouse.listTransfers(q)
    }

    @Get('warehouse-transfers/:id')
    transfer(@Param('id') id: string) {
        return this.warehouse.transfer(id)
    }

    @Post('warehouse-transfers')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    createTransfer(@Body() dto: UpsertWarehouseTransferDto) {
        return this.warehouse.saveTransfer(dto)
    }

    @Put('warehouse-transfers/:id')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    updateTransfer(@Param('id') id: string, @Body() dto: UpsertWarehouseTransferDto) {
        return this.warehouse.saveTransfer(dto, id)
    }

    @Patch('warehouse-transfers/:id/status')
    @RequirePermissions(PERMISSIONS.operations.warehouseManage)
    changeTransferStatus(@Param('id') id: string, @Body() dto: ChangeWarehouseTransferStatusDto) {
        return this.warehouse.changeTransferStatus(id, dto.status, dto.actualArrivalDate)
    }

    @Get('vehicles')
    vehicles(@Query() q: PageQueryDto & { supplierCustomerId?: string; isActive?: string }) {
        return this.road.listVehicles(q)
    }

    @Get('vehicles/:id')
    vehicle(@Param('id') id: string) {
        return this.road.vehicle(id)
    }

    @Post('vehicles')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    createVehicle(@Body() dto: UpsertVehicleDto) {
        return this.road.saveVehicle(dto)
    }

    @Put('vehicles/:id')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    updateVehicle(@Param('id') id: string, @Body() dto: UpsertVehicleDto) {
        return this.road.saveVehicle(dto, id)
    }

    @Post('vehicles/:id/documents')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    createVehicleDocument(@Param('id') id: string, @Body() dto: UpsertVehicleDocumentDto) {
        return this.road.saveVehicleDocument(id, dto)
    }

    @Put('vehicles/:vehicleId/documents/:id')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    updateVehicleDocument(
        @Param('vehicleId') vehicleId: string,
        @Param('id') id: string,
        @Body() dto: UpsertVehicleDocumentDto,
    ) {
        return this.road.saveVehicleDocument(vehicleId, dto, id)
    }

    @Get('drivers')
    drivers(@Query() q: PageQueryDto & { supplierCustomerId?: string; isActive?: string }) {
        return this.road.listDrivers(q)
    }

    @Get('drivers/:id')
    driver(@Param('id') id: string) {
        return this.road.driver(id)
    }

    @Post('drivers')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    createDriver(@Body() dto: UpsertDriverDto) {
        return this.road.saveDriver(dto)
    }

    @Put('drivers/:id')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    updateDriver(@Param('id') id: string, @Body() dto: UpsertDriverDto) {
        return this.road.saveDriver(dto, id)
    }

    @Post('drivers/:id/documents')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    createDriverDocument(@Param('id') id: string, @Body() dto: UpsertDriverDocumentDto) {
        return this.road.saveDriverDocument(id, dto)
    }

    @Put('drivers/:driverId/documents/:id')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    updateDriverDocument(@Param('driverId') driverId: string, @Param('id') id: string, @Body() dto: UpsertDriverDocumentDto) {
        return this.road.saveDriverDocument(driverId, dto, id)
    }

    @Get('vehicle-dispatches')
    dispatches(@Query() q: PageQueryDto & { vehicleId?: string; driverId?: string; from?: string; to?: string }) {
        return this.road.listDispatches(q)
    }

    @Get('vehicle-dispatches/:id')
    dispatch(@Param('id') id: string) {
        return this.road.dispatch(id)
    }

    @Post('vehicle-dispatches')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    createDispatch(@Body() dto: UpsertVehicleDispatchDto) {
        return this.road.saveDispatch(dto)
    }

    @Put('vehicle-dispatches/:id')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    updateDispatch(@Param('id') id: string, @Body() dto: UpsertVehicleDispatchDto) {
        return this.road.saveDispatch(dto, id)
    }

    @Patch('vehicle-dispatches/:id/status')
    @RequirePermissions(PERMISSIONS.operations.roadManage)
    changeDispatchStatus(@Param('id') id: string, @Body() dto: ChangeVehicleDispatchStatusDto) {
        return this.road.changeDispatchStatus(id, dto.status, dto.at)
    }
}
