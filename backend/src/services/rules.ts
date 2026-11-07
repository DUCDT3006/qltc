export interface CategorizationResult {
  categoryName: string;
  jarCode: string; // 'NEC' | 'FFA' | 'LTSS' | 'EDU' | 'PLAY' | 'GIVE'
  confidence: number;
  matchedKeyword?: string;
}

export const DEFAULT_RULES: { keywords: string[]; categoryName: string; jarCode: string }[] = [
  // 1. DI CHUYỂN (Thiết yếu)
  {
    keywords: ['GRAB', 'BE GROUP', 'BE VIETNAM', 'TAXI', 'MAI LINH', 'VINASUN', 'XANG', 'PETROLIMEX', 'XEMAY', 'PVOIL', 'VE XE', 'GUI XE', 'THUE XE'],
    categoryName: 'Di chuyển',
    jarCode: 'NEC'
  },
  // 2. MUA SẮM (Hưởng thụ)
  {
    keywords: ['SHOPEE', 'TIKI', 'LAZADA', 'TIKTOK SHOP', 'ZARA', 'UNIQLO', 'H&M', 'COOLMATE', 'SHOPPING'],
    categoryName: 'Mua sắm',
    jarCode: 'PLAY'
  },
  // 3. CAFE & ĂN UỐNG HƯỞNG THỤ
  {
    keywords: ['HIGHLANDS', 'PHUC LONG', 'STARBUCKS', 'THE COFFEE HOUSE', 'KATINAT', 'CHELSEA', 'CAFE', 'COFFEE', 'TRA SUA', 'GONG CHA', 'KOI THE'],
    categoryName: 'Cafe & Trà',
    jarCode: 'PLAY'
  },
  // 4. ĂN UỐNG THIẾT YẾU (Đi chợ, siêu thị)
  {
    keywords: ['WINMART', 'BACH HOA XANH', 'COOPMART', 'BIG C', 'GO!', 'AEON', 'MEGAMARKET', 'DI CHO', 'TIEN CHO', 'THIT', 'RAU', 'AN SANG', 'COM TRUA', 'BUN', 'PHO', 'COM TAM'],
    categoryName: 'Ăn uống hàng ngày',
    jarCode: 'NEC'
  },
  // 5. HÓA ĐƠN & TIỆN ÍCH (Thiết yếu)
  {
    keywords: ['TIEN NHA', 'TIEN DIEN', 'EVN', 'TIEN NUOC', 'VIETTEL', 'VNPT', 'FPT TELECOM', 'INTERNET', 'CUOC DIEN THOAI', 'PHI DICH VU', 'CHUNG CU'],
    categoryName: 'Hóa đơn & Nhà ở',
    jarCode: 'NEC'
  },
  // 6. GIÁO DỤC (EDU)
  {
    keywords: ['HOC PHI', 'KHOA HOC', 'SACH', 'TIKI BOOKS', 'FAHASA', 'UDEMY', 'COURSERA', 'ENGLISH', 'TIENG ANH', 'TIEN HOC', 'HOC MO'],
    categoryName: 'Học tập & Sách',
    jarCode: 'EDU'
  },
  // 7. CHO ĐI (GIVE)
  {
    keywords: ['MUNG CUOI', 'DAM CUOI', 'SINH NHAT', 'BIEU BO', 'BIEU ME', 'BIU BO', 'BIU ME', 'TU THIEN', 'UNG HO', 'QUYEN GOP', 'GIVE'],
    categoryName: 'Hiếu hỉ & Cho đi',
    jarCode: 'GIVE'
  },
  // 8. ĐẦU TƯ (FFA)
  {
    keywords: ['VPS', 'TCBS', 'SSI', 'VNDIRECT', 'BINANCE', 'REMITANO', 'FMARKET', 'DRAGON CAPITAL', 'VCBF', 'MUA CP', 'CHUNG KHOAN'],
    categoryName: 'Đầu tư tài chính',
    jarCode: 'FFA'
  }
];

export function categorizeTransaction(
  description: string,
  type: 'income' | 'expense',
  userRules?: { pattern: string; categoryName: string; jarCode: string }[]
): CategorizationResult {
  const upper = description.toUpperCase();

  // 1. Kiểm tra quy tắc người dùng đã dạy / tự học trước tiên (ưu tiên cao nhất 0.99)
  if (userRules && userRules.length > 0) {
    for (const ur of userRules) {
      if (upper.includes(ur.pattern.toUpperCase())) {
        return {
          categoryName: ur.categoryName,
          jarCode: ur.jarCode,
          confidence: 0.99,
          matchedKeyword: ur.pattern
        };
      }
    }
  }

  if (type === 'income') {
    if (upper.includes('LUONG') || upper.includes('SALARY') || upper.includes('THANH TOAN LUONG')) {
      return { categoryName: 'Lương chính', jarCode: 'NEC', confidence: 0.98, matchedKeyword: 'LUONG' };
    }
    if (upper.includes('FREELANCE') || upper.includes('DU AN') || upper.includes('THU LAO')) {
      return { categoryName: 'Thu nhập ngoài / Freelance', jarCode: 'FFA', confidence: 0.9, matchedKeyword: 'FREELANCE' };
    }
    if (upper.includes('CHO THUE') || upper.includes('TIEN NHA')) {
      return { categoryName: 'Cho thuê tài sản', jarCode: 'FFA', confidence: 0.92, matchedKeyword: 'CHO THUE' };
    }
    if (upper.includes('CO TUC') || upper.includes('LAI TIEN GUI') || upper.includes('LAI TK') || upper.includes('LOI NHUAN') || upper.includes('SINH LOI')) {
      return { categoryName: 'Thu nhập thụ động & Lãi', jarCode: 'FFA', confidence: 0.95, matchedKeyword: 'SINH LOI' };
    }
    return { categoryName: 'Thu nhập khác', jarCode: 'NEC', confidence: 0.5 };
  }

  // Phân loại chi tiêu
  for (const rule of DEFAULT_RULES) {
    for (const kw of rule.keywords) {
      if (upper.includes(kw)) {
        return {
          categoryName: rule.categoryName,
          jarCode: rule.jarCode,
          confidence: 0.95,
          matchedKeyword: kw
        };
      }
    }
  }

  return {
    categoryName: 'Chi tiêu khác',
    jarCode: 'NEC',
    confidence: 0.4
  };
}
