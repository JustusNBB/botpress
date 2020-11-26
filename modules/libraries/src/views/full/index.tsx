import { confirmDialog, lang, toast } from 'botpress/shared'
import { Container, ItemList, SidePanel, SidePanelSection, SplashScreen } from 'botpress/ui'
import React, { useEffect, useState } from 'react'

import style from './style.scss'
import AddLibrary from './AddLibrary'

export interface InstalledLibrary {
  name: string
  version: string
}

const MainView = props => {
  const [libraries, setLibraries] = useState([])
  const [page, setPage] = useState('splash')
  const [lib, setLib] = useState<InstalledLibrary>()

  useEffect(() => {
    // tslint:disable-next-line: no-floating-promises
    refreshLibraries()
  }, [])

  const refreshLibraries = async () => {
    const { data } = await props.bp.axios.get('/mod/libraries/list')

    setLibraries(
      Object.entries(data).map(([name, version]) => ({
        label: (
          <span>
            <strong>{name}</strong> <small>{version}</small>
          </span>
        ),
        data: { name, version },
        value: name,
        contextMenu: [
          {
            label: lang.tr('delete'),
            icon: 'delete',
            onClick: () => deleteLibrary(name)
          }
        ]
      }))
    )
  }

  const deleteLibrary = async (name: string) => {
    if (!(await confirmDialog('Are you sure you want to remove this library ?', { acceptLabel: 'Remove' }))) {
      return
    }

    try {
      await props.bp.axios.post('/mod/libraries/delete', { name })
      await refreshLibraries()
      toast.info('Library removed successfully')
    } catch (err) {
      toast.failure('There was an error while removing the library. Check server logs for more details')
    }
  }

  const handleLibClicked = item => {
    setLib(item.data)
  }

  const commonProps = { refreshLibraries, setPage }

  return (
    <Container>
      <SidePanel>
        <SidePanelSection
          label={lang.tr('module.libraries.libraries')}
          actions={[
            { icon: 'add', tooltip: lang.tr('add'), onClick: () => setPage('add') },
            { icon: 'upload', tooltip: lang.tr('upload archive'), onClick: () => setPage('upload') }
          ]}
        >
          <ItemList items={libraries} onElementClicked={handleLibClicked} />
        </SidePanelSection>
      </SidePanel>
      <div>
        {page === 'splash' && (
          <SplashScreen
            icon="book"
            title={lang.tr('module.libraries.fullName')}
            description={
              <div>
                {lang.tr('module.libraries.splash.text1')}
                <br />
                <br />
                {lang.tr('module.libraries.splash.text2')}
              </div>
            }
          />
        )}

        <div className={style.container}>
          {page === 'add' && <AddLibrary axios={props.bp.axios} {...commonProps} />}
        </div>
      </div>
    </Container>
  )
}

export default MainView
