// src/common/upload/file-validation.pipe.ts
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'

@Injectable()
export class FileValidationPipe implements PipeTransform {
    constructor(
        private readonly accept?: string[],
        private readonly maxSize?: number,
    ) {}

    transform(file?: Express.Multer.File) {
        if (!file) throw new BadRequestException('Không có file')
        if (this.accept?.length && !this.accept.includes(file.mimetype)) {
            throw new BadRequestException('Định dạng không hỗ trợ')
        }
        if (this.maxSize && file.size > this.maxSize) {
            throw new BadRequestException('File quá lớn')
        }
        return file
    }
}
