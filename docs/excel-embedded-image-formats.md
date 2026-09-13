# Excel 内嵌图片的多种存储方案（.xlsx 内部结构对比）

## 背景

批量导入客户功能（`docs/client-batch-import-design.md`）依赖从 Excel 模板里提取营业执照/身份证图片再送 OCR。实测发现：**同一个 `.xlsx` 文件，"图片是怎么放进单元格里的"这件事本身存在多种互不兼容的技术方案**，不同 Excel 编辑器（Excel 原生 / WPS / 未来可能的钉钉文档、飞书文档等）导出的结果在 zip 包内部结构上完全不同，需要针对性适配，否则会出现"图片解析为空 → OCR 未执行 → 所有 OCR 依赖字段校验失败"的连锁报错（参见 2026-09-13 排查记录）。

本文档记录已知的几种方案，供后续开发对接、扩展新的解析路径时参考。当前实现见 `apps/api/src/clients/import/excel-parser.service.ts`。

## 方案一：标准浮动锚点图（Excel 原生 / 规范工具导出）

**特征**：图片作为"浮动对象"悬浮在单元格上方，不是单元格内容本身。

**zip 内部结构**：
```
xl/drawings/drawing1.xml          # 锚点信息：图片悬浮在哪一行/列，偏移多少
xl/drawings/_rels/drawing1.xml.rels   # rId -> 图片文件的映射关系
xl/media/image1.png               # 图片二进制本体
```

**关键 XML 片段**（`drawing1.xml`）：
```xml
<xdr:oneCellAnchor>
  <xdr:from><xdr:col>1</xdr:col>...</xdr:from>
  <xdr:pic>
    <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
  </xdr:pic>
</xdr:oneCellAnchor>
```

**当前处理**：`ExcelParserService.extractImages()`，直接用 exceljs 的 `worksheet.getImages()`（exceljs 内部按上述标准路径解析）。

**定位方式**：按锚点的 `tl.col`（起始列，浮点数）判断图片落在哪个目标列区间，再按从左到右顺序对应"营业执照/身份证正面/身份证反面"三个槽位（详见 `assignImagesBySequentialOrder` 的实现注释，处理整体列偏移的场景）。

## 方案二：WPS 导出的浮动锚点图（非标准媒体路径）

**特征**：锚点结构与方案一完全相同（依然是 `xdr:oneCellAnchor`/`xdr:twoCellAnchor`），但部分版本的 WPS 导出时，图片实体文件没有放在标准的 `xl/media/*`，而是放在 `xl/drawings/media/*`，导致 exceljs 内部按标准路径找不到文件、`getImages()` 直接返回空结果（图片存在但"读不到"）。

**zip 内部结构**：
```
xl/drawings/drawing1.xml
xl/drawings/_rels/drawing1.xml.rels
xl/drawings/media/image1.png      # 注意：在 drawings/ 目录下而不是 xl/media/
```

**当前处理**：`ExcelParserService.extractImagesFallback()`，仅在方案一"标准方式一张图都没解析到"时触发；用 `adm-zip` 直接打开压缩包，正则解析 `drawing*.xml` 的锚点 + `drawing*.xml.rels` 的关系映射，手动拼出 `xl/drawings/media/*` 路径读取二进制。

## 方案三：WPS「插入单元格图片」/ DISPIMG（未适配，本次报错的根因）

**特征**：这是 WPS 特有的"单元格图片"功能（与 Excel 365 的 `=IMAGE()` 函数、WPS 自己的 `=DISPIMG()` 函数类似），图片**作为单元格的公式结果**存在，而不是悬浮对象，因此**完全不经过 `xl/drawings/` 体系**。

**单元格内容**（`xl/worksheets/sheetN.xml` 对应单元格）：
```
公式: _xlfn.DISPIMG("ID_3654D3570AB743EDA675788E119E9613", 1)
```

**zip 内部结构**：
```
xl/cellimages.xml                 # WPS 私有扩展（命名空间 www.wps.cn），
                                   # 记录 ID 字符串 -> rId 的映射
xl/_rels/cellimages.xml.rels      # rId -> 图片文件的映射关系
xl/media/image1.jpeg              # 图片二进制本体
```

**关键 XML 片段**（`cellimages.xml`，注意 `etc` 是 WPS 私有命名空间 `http://www.wps.cn/officeDocument/2017/etCustomData`）：
```xml
<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" ...>
  <etc:cellImage>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="2" name="ID_3654D3570AB743EDA675788E119E9613" .../>
      </xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
    </xdr:pic>
  </etc:cellImage>
</etc:cellImages>
```

**定位方式**：与方案一/二靠"锚点列偏移"不同，这里靠**公式里的 ID 字符串**反查：
1. 遍历目标 sheet 的单元格，找出公式匹配 `_xlfn.DISPIMG\("(ID_[0-9A-F]+)"` 的单元格，记录其 `(行, 列, ID)`；
2. 用 ID 去 `xl/cellimages.xml` 里找到对应 `<etc:cellImage>`，取其 `<a:blip r:embed="rIdX">` 的 `rIdX`；
3. 用 `rIdX` 去 `xl/_rels/cellimages.xml.rels` 换算出 `Target`（如 `media/image1.jpeg`），实际路径为 `xl/media/image1.jpeg`；
4. 从 zip 里读出该文件的二进制。
5. 图片归属的目标列直接取步骤 1 里记录的单元格列号即可（不需要像方案一/二那样处理浮点偏移，因为图片就是单元格本身的内容，列号是整数、精确）。

**当前处理**：**尚未实现**。exceljs 的 `getImages()` 完全不解析这套私有扩展，现有的方案二兜底也只找 `xl/drawings/drawing*.xml`，两者对 `xl/cellimages.xml` 都无感知，所以图片解析结果恒为空。

**影响范围**：任何使用 WPS「插入单元格图片」功能（而非"插入图片"浮动图功能）填写模板的用户，营业执照/身份证图片都无法被识别，导致 OCR 未执行、公司信息/法人信息等全部字段级联报空值校验错误。

## 后续扩展建议

新增解析路径的判断顺序建议保持"仅在前序方案均未找到图片时才触发"（与现有方案二的触发条件一致），避免不同方案之间互相覆盖或产生歧义：

```
方案一（标准 getImages） 
  → 若为空，方案二（xl/drawings/media 兜底）
  → 若仍为空，方案三（xl/cellimages.xml，DISPIMG 兜底，待实现）
```

如未来遇到钉钉文档/飞书文档导出的其他私有扩展格式，可按同样思路排查：先看单元格公式/值是否有特殊标记（如自定义函数名），再解压 zip 找有无对应的私有 XML 命名空间文件。
