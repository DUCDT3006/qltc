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
  // 4. ĂN UỐNG THIẾT YẾU (Đi chợ, siêu thị - tránh 'TIEN CHO' vì trùng 'CHUYEN TIEN CHO ...' không dấu!)
  {
    keywords: ['WINMART', 'BACH HOA XANH', 'COOPMART', 'BIG C', 'SIEU THI GO', 'AEON', 'MEGAMARKET', 'DI CHO', 'CHO DAN SINH', 'SIEU THI', 'TAP HOA', 'AN SANG', 'COM TRUA', 'AN TOI', 'AN PHO', 'PHO BO', 'PHO GA', 'AN BUN', 'BUN BO', 'COM TAM'],
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

function normalizeVietnameseUpper(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'D')
    .toUpperCase();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWordKeyword(normalizedText: string, keyword: string): boolean {
  const normKw = normalizeVietnameseUpper(keyword).trim();
  if (!normKw) return false;
  const re = new RegExp(`(?:^|[^A-Z0-9])${escapeRegex(normKw)}(?:$|[^A-Z0-9])`);
  return re.test(normalizedText);
}

export function categorizeTransaction(
  description: string,
  type: 'income' | 'expense',
  userRules?: { pattern: string; categoryName: string; jarCode: string }[]
): CategorizationResult {
  const upper = normalizeVietnameseUpper(description);

  // 1. Kiểm tra quy tắc người dùng đã dạy / tự học trước tiên (ưu tiên cao nhất 0.99)
  if (userRules && userRules.length > 0) {
    for (const ur of userRules) {
      if (hasWordKeyword(upper, ur.pattern) || upper.includes(normalizeVietnameseUpper(ur.pattern))) {
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
    if (hasWordKeyword(upper, 'LUONG') || hasWordKeyword(upper, 'SALARY') || hasWordKeyword(upper, 'THANH TOAN LUONG')) {
      return { categoryName: 'Lương chính', jarCode: 'NEC', confidence: 0.98, matchedKeyword: 'LUONG' };
    }
    if (hasWordKeyword(upper, 'FREELANCE') || hasWordKeyword(upper, 'DU AN') || hasWordKeyword(upper, 'THU LAO')) {
      return { categoryName: 'Thu nhập ngoài / Freelance', jarCode: 'FFA', confidence: 0.9, matchedKeyword: 'FREELANCE' };
    }
    if (hasWordKeyword(upper, 'CHO THUE') || hasWordKeyword(upper, 'TIEN NHA')) {
      return { categoryName: 'Cho thuê tài sản', jarCode: 'FFA', confidence: 0.92, matchedKeyword: 'CHO THUE' };
    }
    if (
      hasWordKeyword(upper, 'CO TUC') ||
      hasWordKeyword(upper, 'LAI TIEN GUI') ||
      hasWordKeyword(upper, 'LAI TK') ||
      hasWordKeyword(upper, 'LOI NHUAN') ||
      hasWordKeyword(upper, 'SINH LOI')
    ) {
      return { categoryName: 'Thu nhập thụ động & Lãi', jarCode: 'FFA', confidence: 0.95, matchedKeyword: 'SINH LOI' };
    }
    return { categoryName: 'Thu nhập khác', jarCode: 'NEC', confidence: 0.5 };
  }

  // Phân loại chi tiêu có dấu đặc thù ("Tiền chợ" có dấu, phân biệt với "CHUYEN TIEN CHO ..." không dấu)
  const rawUpper = (description || '').toUpperCase();
  if (rawUpper.includes('TIỀN CHỢ') || rawUpper.includes('ĐI CHỢ')) {
    return { categoryName: 'Ăn uống hàng ngày', jarCode: 'NEC', confidence: 0.96, matchedKeyword: 'TIỀN CHỢ' };
  }

  // Phân loại chi tiêu theo ranh giới từ chuẩn xác (tránh 'PHONG' khớp nhầm 'PHO' hoặc 'CHO' khớp nhầm)
  for (const rule of DEFAULT_RULES) {
    for (const kw of rule.keywords) {
      if (hasWordKeyword(upper, kw)) {
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
