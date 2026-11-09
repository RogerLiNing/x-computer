# PDF 扫描件本地识别

在助手对话附上 PDF，要求“识别扫描内容并整理结果”。助手可通过现有 `file.extract_text` 的 `ocr=true` 参数识别扫描页，不需要用户填写工具参数。基本账号沿用原文档读取权限；不新增记忆写入，也不修改输入文件。

识别在服务端本地进行：PDF.js 渲染页面，Tesseract 从标准输入读取图像并将文字返回标准输出，不写临时页面文件，不调用外部 OCR API。提取文字进入当前助手模型上下文；使用远端模型时，这些文字仍会发送给所选模型，不能声称整个助手任务都不出本机。

开启 OCR 后，每一页均识别完整渲染图像，包含自带页脚文字层的扫描件。原文字层保留，后面附上 OCR 文字，可能重复。结果保留原页码和 SHA256；续读同时携带 `ocr=true`、上一段 `next_offset` 和 `sha256`。`warnings` 提示遗漏、错字和空白识别风险；没有识别出文字不等于页面没有内容。OCR 是文字提取，不还原表格、签章、数学公式或原版式，不代替人工核对。

## 服务端依赖

Linux 或 macOS，Node.js 最低 22.13.0；正常安装 PDF.js 的可选 Canvas 依赖。系统安装 Tesseract 以及简体中文 `chi_sim`、英文 `eng` 语言包。检查：

```bash
tesseract --list-langs
```

Debian/Ubuntu：

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim
```

macOS Homebrew：

```bash
brew install tesseract tesseract-lang
```

程序默认从服务端 PATH 查找 `tesseract`。管理员可通过 `X_COMPUTER_TESSERACT_BIN` 指定可执行文件，通过 `TESSDATA_PREFIX` 指定语言包目录；这些是可信服务器配置，用户、模型和 HTTP 请求不能选择程序。隔离验收入口不继承这两个覆盖变量，使用其筛选后的 PATH 和默认语言包目录。缺少引擎或语言包时明确报错，不静默改成英文，也不返回空白成功。

安装依据：[Tesseract 官方安装文档](https://github.com/tesseract-ocr/tessdoc/blob/main/Installation.md)、[命令行文档](https://github.com/tesseract-ocr/tessdoc/blob/main/Command-Line-Usage.md)。

## 资源与取消

OCR 每次最多 10 页、PDF 原文件最多 16 MiB、提取文字最多 1 MiB；每页输出画布最多约 4 百万像素、边长最多 4096 像素，嵌入图像最大 16 百万像素，超过渲染能力可能遗漏，需对照原件。单页 OCR 最多 10 秒，整次读取最多 60 秒；普通文字层解析仍为 200 页和 30 秒。

继续复用每个服务进程最多两个 PDF 读取名额和 PDF 子进程 256 MiB V8 堆上限；Tesseract 固定单线程。取消、超时或服务进程消失时终止解析器及 OCR 进程组，不在后台继续识别。这里不是操作系统内存硬限额、容器沙箱或跨实例配额。

打开 PDF 预览后可点“识别扫描文字”，在原预览中显示结果；可以停止识别，关闭窗口同样取消后台操作。失败、取消保留原有文字和下载入口，文件已变化则要求重新打开。空白识别不会提示文字已成功识别。预览接口默认仍只读取文字层；OCR 请求必须携带打开时的 SHA256，并由服务端校验。Vite 开发代理只为办公读取转发客户端断开，避免界面停止后后台继续识别；此钩子不处理写入 API。单张图片可以直接附到聊天让支持图片的模型识别；这条本地 OCR 入口目前仅接受 PDF。手写、复杂表格、低清照片及其他语种仍需另行验收。

## 回归

```bash
npm run test --workspace=server -- src/office/pdf.ocr.test.ts src/office/pdf.test.ts src/orchestrator/tools/file/extract.test.ts src/routes/fs.office.test.ts
```

原生 OCR 样例测试仅在本机具有上述中英文引擎时运行；缺少依赖会明确显示 skipped。引擎缺失、输出限制、取消、超时和父进程退出由专用假引擎验证。样例 PDF 只含合成测试数据，不能用来宣称复杂真实业务材料已通过验收。
