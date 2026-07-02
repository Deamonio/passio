#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak, Image
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime

# 한글 폰트 설정
try:
    pdfmetrics.registerFont(TTFont('NanumGothic', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'))
    font_name = 'NanumGothic'
except:
    font_name = 'Helvetica'

# 스타일 설정
styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    'CustomTitle',
    parent=styles['Heading1'],
    fontSize=24,
    textColor=colors.HexColor('#1f4788'),
    spaceAfter=30,
    alignment=1,
    fontName=font_name
)

heading_style = ParagraphStyle(
    'CustomHeading',
    parent=styles['Heading2'],
    fontSize=14,
    textColor=colors.HexColor('#2c5aa0'),
    spaceAfter=12,
    spaceBefore=12,
    fontName=font_name,
    borderColor=colors.HexColor('#2c5aa0'),
    borderWidth=1,
    borderPadding=5
)

normal_style = ParagraphStyle(
    'CustomNormal',
    parent=styles['Normal'],
    fontSize=10,
    leading=14,
    fontName=font_name
)

small_style = ParagraphStyle(
    'CustomSmall',
    parent=styles['Normal'],
    fontSize=9,
    leading=12,
    fontName=font_name
)

# 파일 읽기 및 데이터 추출
input_file = '/home/ubuntu/forge/performance_comparison/results/repeats_full_pipeline/full_pipeline_run_02_raw.jsonl'
output_file = '/home/ubuntu/forge/performance_comparison/results/extracted_30_items.pdf'

data = []
with open(input_file, 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i >= 30:
            break
        try:
            item = json.loads(line)
            parsed = item.get('parsed', {})
            data.append({
                'index': parsed.get('index', i+1),
                'subject': parsed.get('과목', 'N/A'),
                'question': parsed.get('문제', 'N/A'),
                'option1': parsed.get('보기1', 'N/A'),
                'option2': parsed.get('보기2', 'N/A'),
                'option3': parsed.get('보기3', 'N/A'),
                'option4': parsed.get('보기4', 'N/A'),
                'answer': parsed.get('답', 'N/A'),
                'ai_answer': parsed.get('AI_정답', 'N/A'),
                'is_correct': parsed.get('is_correct', 'N/A'),
                'explanation': parsed.get('해설', 'N/A')[:300] + '...' if parsed.get('해설') and len(parsed.get('해설', '')) > 300 else parsed.get('해설', 'N/A')
            })
        except json.JSONDecodeError:
            continue

# PDF 문서 생성
doc = SimpleDocTemplate(output_file, pagesize=A4,
                       rightMargin=0.5*cm, leftMargin=0.5*cm,
                       topMargin=0.7*cm, bottomMargin=0.7*cm)

# 스토리 생성
story = []

# 제목
title = Paragraph("TCP/IP 네트워크 기본 개념 문제 모음", title_style)
story.append(title)

# 메타정보
meta_text = f"<b>생성일시:</b> {datetime.now().strftime('%Y년 %m월 %d일 %H:%M:%S')}<br/>" \
            f"<b>총 항목 수:</b> {len(data)}개<br/>" \
            f"<b>데이터 출처:</b> Performance Comparison Results"
story.append(Paragraph(meta_text, small_style))
story.append(Spacer(1, 0.3*cm))

# 각 항목별 표 생성
for idx, item in enumerate(data):
    # 항목 번호
    item_header = f"문제 {item['index']} - {item['subject']}"
    story.append(Paragraph(item_header, heading_style))
    
    # 문제 및 옵션 데이터
    table_data = [
        ['필드', '내용'],
        ['문제', item['question']],
        ['① 보기', item['option1']],
        ['② 보기', item['option2']],
        ['③ 보기', item['option3']],
        ['④ 보기', item['option4']],
        ['정답', f"{item['answer']}번"],
        ['AI 정답', f"{item['ai_answer']}번"],
        ['정답 여부', '○' if item['is_correct'] == 1 else '✗'],
        ['해설 (요약)', item['explanation']]
    ]
    
    # 테이블 스타일
    table = Table(table_data, colWidths=[1.5*cm, 13.5*cm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e8f0f8')),
        ('BACKGROUND', (0, 0), (1, 0), colors.HexColor('#2c5aa0')),
        ('TEXTCOLOR', (0, 0), (1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('FONTNAME', (0, 0), (1, 0), font_name),
        ('FONTSIZE', (0, 0), (1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('FONTNAME', (0, 1), (-1, -1), font_name),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f9fc')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
    ]))
    
    story.append(table)
    story.append(Spacer(1, 0.4*cm))
    
    # 매 5개 문제마다 페이지 나눔
    if (idx + 1) % 5 == 0 and idx < len(data) - 1:
        story.append(PageBreak())

# PDF 생성
doc.build(story)
print(f"✓ PDF 생성 완료: {output_file}")
print(f"✓ 총 {len(data)}개의 문제가 포함되었습니다.")
