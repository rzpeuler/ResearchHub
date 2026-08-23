export const CNINFO_ANNOUNCEMENT_RESPONSE_FIXTURE = {
  announcements: [
    {
      announcementTitle: '关于公司经营情况的公告',
      announcementContent: '公司发布了经营情况公告正文。',
      announcementTime: '2026-08-21 09:30:00',
      secCode: '600519.SH',
      secName: '贵州茅台',
      adjunctUrl: 'finalpage/2026-08-21/1234567890.PDF',
      source: 'cninfo',
    },
  ],
} as const

export const CNINFO_ISSUER_ONLY_FIXTURE = [
  {
    title: '关于公司治理事项的公告',
    content: '公司发布治理事项公告正文。',
    publishedAt: '2026-08-22T01:30:00.000Z',
    source: 'cninfo',
    issuerName: '贵州茅台',
  },
] as const
