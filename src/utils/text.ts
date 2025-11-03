// src/utils/text.ts
export function removeDiacriticsToUpperNoSpace(input: string) {
    return (input || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
}
