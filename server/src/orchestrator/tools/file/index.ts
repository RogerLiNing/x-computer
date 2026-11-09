/**
 * file 类工具统一导出：file.read / file.write / file.tail / file.replace / file.parse / file.list
 */
import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { fileReadDefinition, createFileReadHandler } from './read.js';
import { fileWriteDefinition, createFileWriteHandler } from './write.js';
import { fileTailDefinition, createFileTailHandler } from './tail.js';
import { fileReplaceDefinition, createFileReplaceHandler } from './replace.js';
import { fileParseDefinition, createFileParseHandler } from './parse.js';
import { fileListDefinition, createFileListHandler } from './list.js';
import { filePresentDefinition, createFilePresentHandler } from './present.js';
import {fileExtractDefinition,createFileExtractHandler}from'./extract.js';
import { fileMoveDefinition, createFileMoveHandler } from './move.js';

export const fileDefinitions: ToolDefinition[] = [
  fileReadDefinition,
  fileWriteDefinition,
  fileTailDefinition,
  fileReplaceDefinition,
  fileParseDefinition,
  fileListDefinition,
  filePresentDefinition,
  fileExtractDefinition,
  fileMoveDefinition,
];

export function createFileHandlers(deps: ToolExecutorDeps): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();
  map.set(fileReadDefinition.name, createFileReadHandler(deps));
  map.set(fileWriteDefinition.name, createFileWriteHandler(deps));
  map.set(fileTailDefinition.name, createFileTailHandler(deps));
  map.set(fileReplaceDefinition.name, createFileReplaceHandler(deps));
  map.set(fileParseDefinition.name, createFileParseHandler(deps));
  map.set(fileListDefinition.name, createFileListHandler(deps));
  map.set(filePresentDefinition.name, createFilePresentHandler(deps));
  map.set(fileExtractDefinition.name,createFileExtractHandler(deps));
  map.set(fileMoveDefinition.name, createFileMoveHandler(deps));
  return map;
}
