import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Lang } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from './api';
import { invalidateProject, keys } from './queries';

/** Switch the workspace language (taskpack.yaml: lang) and the UI with it. */
export function useChangeLang() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lang: Lang) => api.setLang(lang),
    onSuccess: async (_d, lang) => {
      await i18n.changeLanguage(lang);
      await qc.invalidateQueries({ queryKey: keys.config });
      invalidateProject(qc);
      toast.success(i18n.t('settings.saved'));
    },
    onError: (err: Error) => toast.error(t('toast.saveFailed'), { description: err.message }),
  });
}
