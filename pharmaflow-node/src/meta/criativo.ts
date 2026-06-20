// Upload de imagem para a Meta Marketing API e criação do AdCreative

import { metaReq } from './client';
import type { MetaToken } from './types';

interface ImageUploadResult {
  hash: string;
  url:  string;
  name: string;
}

// Faz upload da imagem (base64) para a conta de anúncios do cliente
export async function uploadImagem(
  token:       MetaToken,
  base64Data:  string,
  _nomeArq:    string,
): Promise<ImageUploadResult> {
  // Remove prefixo data URI se houver (ex: data:image/jpeg;base64,...)
  const bytes = base64Data.replace(/^data:image\/\w+;base64,/, '');

  const result = await metaReq<{ images: Record<string, ImageUploadResult> }>(
    'POST',
    `/${token.adAccountId}/adimages`,
    token.accessToken,
    { bytes },
  );

  const keys = Object.keys(result.images ?? {});
  if (!keys.length) throw new Error('Upload de imagem não retornou resultado');
  return result.images[keys[0]];
}

// Cria o AdCreative (combinação de imagem + copy + página)
export async function criarAdCreative(
  token:       MetaToken,
  imagemHash:  string,
  copy:        string,
  linkDestino: string,
): Promise<{ id: string }> {
  return metaReq<{ id: string }>(
    'POST',
    `/${token.adAccountId}/adcreatives`,
    token.accessToken,
    {
      name: 'Criativo via Automação',
      object_story_spec: {
        page_id:   token.pageId,
        link_data: {
          image_hash: imagemHash,
          link:       linkDestino,
          message:    copy,
        },
      },
    },
  );
}
